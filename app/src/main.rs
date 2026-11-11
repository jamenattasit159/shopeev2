//! Shopee Clip V2: local server. Receives product data from the Chrome extension,
//! runs one clip job at a time, and serves the single-page UI.
mod llm;
mod pipeline;
mod plan;
mod story;

use anyhow::{Context, Result};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path as UrlPath, Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::{mpsc, watch, RwLock};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Keys {
    pub gemini: String,
    pub claude: String,
    pub gpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Models {
    pub gemini: String,
    pub claude: String,
    pub gpt: String,
}
impl Default for Models {
    fn default() -> Self {
        Self { gemini: "gemini-2.5-flash".into(), claude: "claude-sonnet-5-5".into(), gpt: String::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub port: u16,
    /// Director providers in fallback order, e.g. ["claude-cli", "gemini-api"].
    pub director: Vec<String>,
    /// Gemini voice id: a cloned voice id or a stock name.
    pub voice: String,
    pub export_dir: String,
    pub keys: Keys,
    pub models: Models,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            port: 4317,
            director: vec!["gemini-api".into()],
            voice: "Puck".into(),
            export_dir: "exports".into(),
            keys: Keys::default(),
            models: Models::default(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Job {
    pub id: String,
    /// "" = a normal clip job, "story" = a Story Ad job (see story.rs)
    pub kind: String,
    pub url: String,
    pub submitted_url: String,
    pub title: String,
    pub name: String,
    /// waiting (for the extension) | ready (for manual start) | queued | running | done | error
    pub state: String,
    pub stage: String,
    pub error: String,
    pub style: String,
    pub seed: u64,
    pub created: u64,
    pub provider: String,
    pub seconds: f64,
    pub warnings: Vec<String>,
    #[serde(skip_deserializing)]
    pub cover_ready: bool,
}

pub struct App {
    pub root: PathBuf,
    pub cfg: RwLock<Config>,
    queue: mpsc::UnboundedSender<String>,
    job_mutations: Mutex<()>,
    shutdown: watch::Sender<bool>,
}
type Shared = Arc<App>;

impl App {
    fn begin_job_mutation(&self) -> Result<std::sync::MutexGuard<'_, ()>> {
        let guard = self.job_mutations.lock().expect("job mutation lock");
        need(!*self.shutdown.borrow(), "ระบบกำลังปิด กรุณาเปิดใหม่ก่อนจัดการงาน")?;
        Ok(guard)
    }

    pub fn job_dir(&self, id: &str) -> PathBuf {
        self.root.join("jobs").join(id)
    }
    pub fn load_job(&self, id: &str) -> Result<Job> {
        let dir = self.job_dir(id);
        let raw = std::fs::read_to_string(dir.join("job.json")).context("ไม่พบงานนี้")?;
        let mut job: Job = serde_json::from_str(&raw)?;
        job.cover_ready = job.state == "done" && dir.join(pipeline::COVER_FILE).is_file();
        Ok(job)
    }
    pub fn save_job(&self, job: &Job) -> Result<()> {
        let dir = self.job_dir(&job.id);
        std::fs::create_dir_all(&dir)?;
        // write-then-rename so a crash never leaves a half-written job file
        let tmp = dir.join("job.json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(job)?)?;
        std::fs::rename(tmp, dir.join("job.json"))?;
        Ok(())
    }
    fn jobs(&self) -> Vec<Job> {
        let mut out: Vec<Job> = std::fs::read_dir(self.root.join("jobs"))
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| self.load_job(&e.file_name().to_string_lossy()).ok())
            .collect();
        out.sort_by(|a, b| b.created.cmp(&a.created));
        out
    }
    fn save_cfg(&self, cfg: &Config) -> Result<()> {
        std::fs::write(self.root.join("config.toml"), toml::to_string_pretty(cfg)?)?;
        Ok(())
    }
}

pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}
fn new_seed() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos() as u64).unwrap_or(1)
}

/// Only letters, digits, dot, dash, underscore survive: ids and file names go straight into paths.
fn safe_name(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')).collect::<String>().trim_matches('.').to_string()
}

fn shopee_url(raw: &str) -> Option<reqwest::Url> {
    let u = reqwest::Url::parse(raw.trim()).ok()?;
    let host = u.host_str()?;
    let ok = u.scheme() == "https" && (host == "shopee.co.th" || host.ends_with(".shopee.co.th") || host == "shp.ee");
    ok.then_some(u)
}

/// Item id is the last number in the path: ".../name-i.SHOP.ITEM" or "/product/SHOP/ITEM".
fn item_id(u: &reqwest::Url) -> Option<String> {
    u.path().rsplit(|c: char| !c.is_ascii_digit()).find(|s| s.len() >= 6).map(String::from)
}

fn same_product(job: &Job, url: &reqwest::Url) -> bool {
    job.url == url.as_str() || job.submitted_url == url.as_str() || item_id(url).is_some_and(|id| {
        job.id == id || shopee_url(&job.url).and_then(|u| item_id(&u)) == Some(id)
    })
}

fn checked_job_id(id: &str) -> Result<&str> {
    need(!id.is_empty() && safe_name(id) == id, "รหัสงานไม่ถูกต้อง")?;
    Ok(id)
}

fn checked_style(style: &str) -> Result<&str> {
    need(style.is_empty() || plan::STYLES.iter().any(|s| s.0 == style), "แนวสคริปต์ไม่ถูกต้อง")?;
    Ok(style)
}

fn ensure_job_idle(job: &Job) -> Result<()> {
    need(!matches!(job.state.as_str(), "queued" | "running"), "งานนี้อยู่ในคิวหรือกำลังทำอยู่")
}

struct ApiError(anyhow::Error);
impl<E: Into<anyhow::Error>> From<E> for ApiError {
    fn from(e: E) -> Self {
        Self(e.into())
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (StatusCode::BAD_REQUEST, Json(json!({"error": format!("{:#}", self.0)}))).into_response()
    }
}
type Api<T> = Result<T, ApiError>;
fn need(ok: bool, msg: &'static str) -> Result<()> {
    if ok { Ok(()) } else { Err(anyhow::anyhow!(msg)) }
}

/// Blocks other websites from driving this server: browsers always send Origin on cross-site
/// POST/PUT, and a rebinding attack shows up as a foreign Host.
async fn guard(State(app): State<Shared>, req: Request, next: Next) -> Response {
    let port = app.cfg.read().await.port;
    let own = [format!("127.0.0.1:{port}"), format!("localhost:{port}")];
    // scoped so the borrow of `req` (not Send) is gone before the await below
    let (host, origin) = {
        let h = |name: header::HeaderName| req.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        (h(header::HOST), h(header::ORIGIN))
    };
    let from_extension = origin.starts_with("chrome-extension://");
    let from_ui = origin.is_empty() || own.iter().any(|o| origin == format!("http://{o}"));
    let path = req.uri().path();
    let ingest = path == "/api/ingest";
    // the extension may post products and read the job list (to see which tab the app is waiting for)
    let allowed = own.contains(&host)
        && if ingest { from_extension } else { from_ui || (from_extension && path == "/api/jobs") };
    if !allowed {
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    next.run(req).await
}

async fn ui() -> Html<&'static str> {
    Html(include_str!("../ui/index.html"))
}

async fn server_status(State(app): State<Shared>) -> Json<Value> {
    Json(json!({"app": "shopee-clip", "stopping": *app.shutdown.borrow()}))
}

async fn shutdown_server(State(app): State<Shared>) -> StatusCode {
    let _mutation = app.job_mutations.lock().expect("job mutation lock");
    app.shutdown.send_replace(true);
    StatusCode::ACCEPTED
}

async fn ui_css() -> ([(header::HeaderName, &'static str); 1], &'static str) {
    ([(header::CONTENT_TYPE, "text/css; charset=utf-8")], include_str!("../ui/app.css"))
}

async fn ui_script() -> ([(header::HeaderName, &'static str); 1], &'static str) {
    ([(header::CONTENT_TYPE, "text/javascript; charset=utf-8")], include_str!("../ui/app.js"))
}

async fn list_jobs(State(app): State<Shared>) -> Json<Vec<Job>> {
    // Story Ad jobs have their own page and states
    Json(app.jobs().into_iter().filter(|j| j.kind != story::KIND).collect())
}

async fn get_job(State(app): State<Shared>, UrlPath(id): UrlPath<String>) -> Api<Json<Job>> {
    Ok(Json(app.load_job(checked_job_id(&id)?)?))
}

#[derive(Deserialize)]
struct LinksReq {
    urls: Vec<String>,
    #[serde(default)]
    style: String,
}
async fn add_links(State(app): State<Shared>, Json(req): Json<LinksReq>) -> Api<Json<Value>> {
    let _mutation = app.begin_job_mutation()?;
    let style = checked_style(&req.style)?;
    let mut jobs = app.jobs();
    let mut urls = Vec::new();
    let mut rejected = Vec::new();
    let mut duplicates = Vec::new();
    for (i, raw) in req.urls.iter().map(|s| s.trim()).filter(|s| !s.is_empty()).enumerate() {
        let Some(u) = shopee_url(raw) else {
            rejected.push(raw.to_string());
            continue;
        };
        if jobs.iter().any(|j| same_product(j, &u)) {
            duplicates.push(raw.to_string());
            continue;
        }
        let id = item_id(&u).unwrap_or_else(|| format!("link{}-{}-{i}", now(), new_seed()));
        let job = Job {
            id,
            url: u.to_string(),
            submitted_url: u.to_string(),
            state: "waiting".into(),
            stage: "รอส่วนขยาย Chrome ส่งข้อมูล".into(),
            style: style.to_string(),
            seed: new_seed() + i as u64,
            created: now(),
            ..Default::default()
        };
        app.save_job(&job)?;
        jobs.push(job);
        urls.push(u);
    }
    let count = urls.len();
    tokio::spawn(async move {
        for u in urls {
            // rundll32 takes the URL as a plain argument: no shell, so "&" in links is harmless
            let _ = tokio::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", u.as_str()]).status().await;
            tokio::time::sleep(std::time::Duration::from_secs(6)).await; // one tab at a time, not a burst
        }
    });
    Ok(Json(json!({"added": count, "rejected": rejected, "duplicates": duplicates})))
}

#[derive(Deserialize)]
struct JobEdit {
    name: Option<String>,
    style: Option<String>,
}

async fn edit_job(State(app): State<Shared>, UrlPath(id): UrlPath<String>, Json(edit): Json<JobEdit>) -> Api<Json<Job>> {
    let _mutation = app.begin_job_mutation()?;
    let mut job = app.load_job(checked_job_id(&id)?)?;
    ensure_job_idle(&job)?;
    if let Some(name) = edit.name.as_deref().map(str::trim) {
        need(name.chars().count() <= 120, "ชื่องานต้องไม่เกิน 120 ตัวอักษร")?;
        job.name = name.to_string();
    }
    if let Some(style) = edit.style {
        job.style = checked_style(&style)?.to_string();
    }
    app.save_job(&job)?;
    Ok(Json(job))
}

async fn delete_job(State(app): State<Shared>, UrlPath(id): UrlPath<String>) -> Api<StatusCode> {
    let _mutation = app.begin_job_mutation()?;
    let id = checked_job_id(&id)?;
    ensure_job_idle(&app.load_job(id)?)?;
    let root = app.root.canonicalize()?;
    let dir = root.join("jobs").join(id);
    need(dir.canonicalize()? == dir, "ตำแหน่งโฟลเดอร์งานไม่ถูกต้อง")?;
    let trash = root.join(".deleted-jobs");
    std::fs::create_dir_all(&trash)?;
    need(trash.canonicalize()? == trash, "ตำแหน่งโฟลเดอร์งานที่ลบไม่ถูกต้อง")?;
    std::fs::rename(dir, trash.join(format!("{id}-{}-{}", now(), new_seed())))?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, Serialize, Default)]
#[serde(default)]
pub struct Product {
    pub url: String,
    pub title: String,
    pub text: String,
    pub images: Vec<String>,
    pub videos: Vec<String>,
    pub gallery_schema: u8,
}
async fn ingest(State(app): State<Shared>, Json(mut p): Json<Product>) -> Api<Json<Value>> {
    let _mutation = app.begin_job_mutation()?;
    let url = shopee_url(&p.url).context("ไม่ใช่หน้าสินค้า Shopee")?;
    let jobs = app.jobs();
    let existing = jobs.iter().find(|j| same_product(j, &url));
    // short links have no item id until they resolve: fall back to the oldest waiting job
    let short = jobs.iter().filter(|j| j.state == "waiting" && j.id.starts_with("link")).min_by_key(|j| j.created);
    let waiting = existing.filter(|j| j.state == "waiting" || (
        matches!(j.state.as_str(), "ready" | "error" | "done") && !pipeline::has_verified_gallery(&app.job_dir(&j.id))
    )).or(short);
    need(waiting.is_some() || existing.is_none(), "มีงานนี้แล้ว จัดการหรือสร้างคลิปใหม่จากหน้าแอปได้")?;
    p.images = match pipeline::gallery_images(&p) {
        Ok(images) => images,
        Err(error) => {
            if let Some(waiting) = waiting.filter(|j| j.state == "waiting") {
                let mut job = waiting.clone();
                job.stage = error.to_string();
                app.save_job(&job)?;
            }
            return Err(error.into());
        }
    };
    let mut job = waiting.cloned().unwrap_or_else(|| Job {
        id: item_id(&url).unwrap_or_else(|| format!("link{}-{}", now(), new_seed())),
        seed: new_seed(),
        created: now(),
        ..Default::default()
    });
    job.url = url.to_string();
    job.title = p.title.chars().take(120).collect();
    if !matches!(job.state.as_str(), "done" | "error") {
        job.state = "ready".into();
        job.stage = "เพิ่มคลิปดิบได้ แล้วกดเริ่มสร้างคลิป".into();
        job.error.clear();
    }
    let dir = app.job_dir(&job.id);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("product.json"), serde_json::to_string_pretty(&p)?)?;
    app.save_job(&job)?;
    story::on_ingest(&app, &job.id);
    Ok(Json(json!({"job": job.id})))
}

async fn rerun(State(app): State<Shared>, UrlPath(id): UrlPath<String>) -> Api<Json<Value>> {
    let _mutation = app.begin_job_mutation()?;
    checked_job_id(&id)?;
    let mut job = app.load_job(&id)?;
    let dir = app.job_dir(&id);
    need(dir.join("product.json").exists(), "งานนี้ยังไม่มีข้อมูลสินค้า")?;
    ensure_job_idle(&job)?;
    need(pipeline::has_verified_gallery(&dir), "เปิดหน้าสินค้าแล้วกดไอคอนส่วนขยาย Shopee Clip เพื่อรับรูปจากแกลเลอรีใหม่")?;
    if job.state != "ready" {
        let dir = app.job_dir(&id);
        for f in ["plan.json", "props.json", "out.mp4", "caption.txt", pipeline::COVER_FILE] {
            let _ = std::fs::remove_file(dir.join(f));
        }
        let _ = std::fs::remove_dir_all(dir.join("pub").join("audio"));
        job.seed = new_seed();
    }
    job.state = "queued".into();
    job.stage = "รอคิว".into();
    job.error.clear();
    job.warnings.clear();
    app.save_job(&job)?;
    app.queue.send(id)?;
    Ok(Json(json!({"ok": true})))
}

async fn upload_clip(
    State(app): State<Shared>,
    UrlPath(id): UrlPath<String>,
    Query(q): Query<HashMap<String, String>>,
    body: Bytes,
) -> Api<Json<Value>> {
    let _mutation = app.begin_job_mutation()?;
    checked_job_id(&id)?;
    ensure_job_idle(&app.load_job(&id)?)?;
    let name = safe_name(q.get("name").map(String::as_str).unwrap_or(""));
    let ext = Path::new(&name).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    need(["mp4", "mov", "webm", "m4v"].contains(&ext.as_str()), "รับเฉพาะไฟล์ mp4, mov, webm")?;
    let dir = app.job_dir(&id).join("clips");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(format!("user_{name}")), &body)?;
    Ok(Json(json!({"ok": true})))
}

async fn get_config(State(app): State<Shared>) -> Json<Value> {
    let c = app.cfg.read().await.clone();
    // keys never leave the server; the UI only learns whether each one is set
    Json(json!({
        "director": c.director, "voice": c.voice, "export_dir": c.export_dir, "models": c.models,
        "has_key": {"gemini": !c.keys.gemini.is_empty(), "claude": !c.keys.claude.is_empty(), "gpt": !c.keys.gpt.is_empty()},
        "providers": llm::PROVIDERS, "styles": plan::STYLES.iter().map(|s| s.0).collect::<Vec<_>>(),
    }))
}

#[derive(Deserialize)]
struct ConfigReq {
    director: Vec<String>,
    voice: String,
    export_dir: String,
    models: Models,
    /// empty string = keep the stored key
    keys: Keys,
}
async fn set_config(State(app): State<Shared>, Json(req): Json<ConfigReq>) -> Api<Json<Value>> {
    let mut guard = app.cfg.write().await;
    let c = &mut *guard;
    let director: Vec<String> = req.director.into_iter().filter(|p| llm::PROVIDERS.contains(&p.as_str())).collect();
    need(!director.is_empty(), "ต้องเลือกผู้ให้บริการ AI อย่างน้อย 1 ทาง")?;
    c.director = director;
    c.voice = req.voice.trim().to_string();
    c.export_dir = req.export_dir.trim().to_string();
    c.models = req.models;
    for (slot, new) in [(&mut c.keys.gemini, req.keys.gemini), (&mut c.keys.claude, req.keys.claude), (&mut c.keys.gpt, req.keys.gpt)] {
        if !new.trim().is_empty() {
            *slot = new.trim().to_string();
        }
    }
    app.save_cfg(c)?;
    Ok(Json(json!({"ok": true})))
}

async fn test_provider(State(app): State<Shared>, Json(req): Json<Value>) -> Api<Json<Value>> {
    let provider = req["provider"].as_str().unwrap_or("");
    let cfg = app.cfg.read().await.clone();
    let reply = llm::complete(provider, &cfg, "ตอบคำว่า OK คำเดียว ไม่ต้องมีอย่างอื่น").await?;
    Ok(Json(json!({"reply": reply.trim().chars().take(80).collect::<String>()})))
}

async fn voices(State(app): State<Shared>) -> Api<Json<Value>> {
    let key = app.cfg.read().await.keys.gemini.clone();
    let out = pipeline::node(&app.root, &["node_modules/tsx/dist/cli.mjs", "tts.ts", "--voices"], &[("GEMINI_API_KEY", key.as_str())]).await?;
    Ok(Json(serde_json::from_str(out.trim().lines().last().unwrap_or("[]"))?))
}

fn find_root() -> Result<PathBuf> {
    let mut dir = std::env::current_dir()?;
    loop {
        if dir.join("render").join("package.json").exists() {
            return Ok(dir);
        }
        need(dir.pop(), "ไม่พบโฟลเดอร์ render/ ให้รันโปรแกรมจากในโฟลเดอร์โปรเจกต์")?;
    }
}

/// First run only: reuse the keys already set up for V1 so the owner does not retype them.
fn import_v1_keys(root: &Path, cfg: &mut Config) {
    let Ok(env) = std::fs::read_to_string(root.join("..").join("Shopee-Video").join(".env.local")) else { return };
    for line in env.lines() {
        let Some((k, v)) = line.split_once('=') else { continue };
        let v = v.trim().trim_matches('"').to_string();
        match k.trim() {
            "GEMINI_API_KEY" if !v.contains("your_gemini") => cfg.keys.gemini = v,
            "ANTHROPIC_API_KEY" => cfg.keys.claude = v,
            _ => {}
        }
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let root = find_root()?;
    std::fs::create_dir_all(root.join("jobs"))?;
    let cfg_path = root.join("config.toml");
    let cfg: Config = match std::fs::read_to_string(&cfg_path) {
        Ok(raw) => toml::from_str(&raw).context("config.toml อ่านไม่ได้")?,
        Err(_) => {
            let mut c = Config::default();
            import_v1_keys(&root, &mut c);
            c
        }
    };
    let port = cfg.port;
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let (shutdown, mut shutdown_signal) = watch::channel(false);
    let app = Arc::new(App { root: root.clone(), cfg: RwLock::new(cfg.clone()), queue: tx, job_mutations: Mutex::new(()), shutdown });
    if !cfg_path.exists() {
        app.save_cfg(&cfg)?;
    }

    // jobs interrupted by a shutdown pick up where they stopped
    for job in app.jobs().into_iter().rev().filter(|j| j.state == "queued" || j.state == "running") {
        app.queue.send(job.id)?;
    }
    let worker = app.clone();
    let queue_worker = tokio::spawn(async move {
        loop {
            let id = tokio::select! {
                biased;
                _ = shutdown_signal.wait_for(|stop| *stop) => break,
                id = rx.recv() => id,
            };
            let Some(id) = id else { break };
            pipeline::run_job(&worker, &id).await;
        }
    });

    let router = Router::new()
        .route("/", get(ui))
        .route("/app.css", get(ui_css))
        .route("/app.js", get(ui_script))
        .route("/api/jobs", get(list_jobs))
        .route("/api/status", get(server_status))
        .route("/api/shutdown", post(shutdown_server))
        .route("/api/jobs/{id}", get(get_job).patch(edit_job).delete(delete_job))
        .route("/api/links", post(add_links))
        .route("/api/ingest", post(ingest))
        .route("/api/jobs/{id}/run", post(rerun))
        .route("/api/jobs/{id}/clip", put(upload_clip).layer(DefaultBodyLimit::max(1024 * 1024 * 1024)))
        .route("/api/config", get(get_config).post(set_config))
        .route("/api/test", post(test_provider))
        .route("/api/voices", get(voices))
        .route("/story", get(story::page))
        .route("/story.js", get(story::page_script))
        .route("/api/story", get(story::list))
        .route("/api/story/link", post(story::add_link))
        .route("/api/story/health", get(story::health))
        .route("/api/story/{id}", get(story::detail))
        .route("/api/story/{id}/scene/{scene}", post(story::edit))
        .route("/api/story/{id}/confirm", post(story::confirm))
        .route("/api/story/{id}/restart", post(story::restart))
        .route("/api/story/{id}/retry", post(story::retry))
        .nest_service("/files", tower_http::services::ServeDir::new(root.join("jobs")))
        .layer(middleware::from_fn_with_state(app.clone(), guard))
        .with_state(app);

    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.context("เปิดพอร์ตไม่ได้ มีโปรแกรมนี้รันอยู่แล้วหรือเปล่า")?;
    println!("Shopee Clip V2 พร้อมใช้งานที่ http://127.0.0.1:{port}");
    axum::serve(listener, router).with_graceful_shutdown(async {
        let _ = queue_worker.await;
    }).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_TEST_ROOT: AtomicUsize = AtomicUsize::new(0);

    struct TestRoot(PathBuf);

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let resolved = self.0.canonicalize();
            let parent = self.0.parent().and_then(|p| p.canonicalize().ok());
            if let (Ok(path), Some(parent)) = (resolved, parent) {
                if path.parent() == Some(parent.as_path()) {
                    let _ = std::fs::remove_dir_all(path);
                }
            }
        }
    }

    fn job_fixture() -> (TestRoot, Shared, Job) {
        let unique = NEXT_TEST_ROOT.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("shopee-clip-test-{}-{}-{unique}", std::process::id(), new_seed()));
        std::fs::create_dir(&path).unwrap();
        let root = TestRoot(path);
        let (queue, _) = mpsc::unbounded_channel();
        let app = Arc::new(App { root: root.0.clone(), cfg: RwLock::new(Config::default()), queue, job_mutations: Mutex::new(()), shutdown: watch::channel(false).0 });
        let job = Job {
            id: "123456789".into(),
            url: "https://shopee.co.th/product/123/123456789".into(),
            title: "ชื่อจาก Shopee".into(),
            state: "done".into(),
            ..Job::default()
        };
        app.save_job(&job).unwrap();
        (root, app, job)
    }

    #[tokio::test]
    async fn adding_links_preserves_finished_jobs_and_deduplicates_new_jobs() {
        let (_root, app, job) = job_fixture();
        let new_url = "https://shopee.co.th/product/123/987654321";
        let Json(result) = add_links(State(app.clone()), Json(LinksReq {
            urls: vec![job.url, new_url.into(), new_url.into()], style: String::new(),
        })).await.unwrap_or_else(|e| panic!("{}", e.0));

        assert_eq!(result["added"], 1);
        assert_eq!(result["duplicates"].as_array().unwrap().len(), 2);
        assert_eq!(app.load_job(&job.id).unwrap().state, "done");
        assert_eq!(app.load_job("987654321").unwrap().state, "waiting");
    }

    #[tokio::test]
    async fn edits_a_finished_job_and_removes_it_without_touching_exports() {
        let (_root, app, job) = job_fixture();
        let export = app.root.join("exports");
        std::fs::create_dir(&export).unwrap();
        let video = export.join("123456789.mp4");
        std::fs::write(&video, b"exported video").unwrap();

        let _ = edit_job(State(app.clone()), UrlPath(job.id.clone()), Json(JobEdit {
            name: Some("  คลิปสินค้า  ".into()), style: Some("worth-it".into()),
        })).await.unwrap_or_else(|e| panic!("{}", e.0));
        let Json(edited) = get_job(State(app.clone()), UrlPath(job.id.clone()))
            .await.unwrap_or_else(|e| panic!("{}", e.0));
        assert_eq!(edited.name, "คลิปสินค้า");
        assert_eq!(edited.title, "ชื่อจาก Shopee");
        assert_eq!(edited.style, "worth-it");

        let status = delete_job(State(app.clone()), UrlPath(job.id.clone()))
            .await.unwrap_or_else(|e| panic!("{}", e.0));
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert!(app.jobs().is_empty());
        assert!(!app.job_dir(&job.id).exists());
        assert_eq!(std::fs::read(&video).unwrap(), b"exported video");
        assert_eq!(std::fs::read_dir(app.root.join(".deleted-jobs")).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn refuses_to_change_a_queued_job() {
        let (_root, app, mut job) = job_fixture();
        job.state = "queued".into();
        app.save_job(&job).unwrap();

        let edit = edit_job(State(app.clone()), UrlPath(job.id.clone()), Json(JobEdit {
            name: Some("แก้ชื่อ".into()), style: None,
        })).await;
        let delete = delete_job(State(app.clone()), UrlPath(job.id.clone())).await;
        assert!(edit.is_err());
        assert!(delete.is_err());
        assert_eq!(app.load_job(&job.id).unwrap().state, "queued");
    }

    #[tokio::test]
    async fn waits_for_manual_start_and_keeps_uploaded_footage() {
        let (_root, mut app, mut job) = job_fixture();
        let (queue, mut receiver) = mpsc::unbounded_channel();
        Arc::get_mut(&mut app).unwrap().queue = queue;
        job.state = "waiting".into();
        app.save_job(&job).unwrap();

        let _ = ingest(State(app.clone()), Json(Product {
            url: job.url,
            images: vec!["https://down-th.img.susercontent.com/file/test-product".into()],
            gallery_schema: 1,
            ..Product::default()
        }))
            .await.unwrap_or_else(|e| panic!("{}", e.0));
        assert_eq!(app.load_job(&job.id).unwrap().state, "ready");
        assert!(receiver.try_recv().is_err());

        let _ = upload_clip(State(app.clone()), UrlPath(job.id.clone()),
            Query(HashMap::from([("name".into(), "raw.mp4".into())])), Bytes::from_static(b"raw footage"))
            .await.unwrap_or_else(|e| panic!("{}", e.0));
        let _ = rerun(State(app.clone()), UrlPath(job.id.clone())).await.unwrap_or_else(|e| panic!("{}", e.0));
        assert_eq!(receiver.try_recv().unwrap(), job.id);
        assert_eq!(app.load_job(&job.id).unwrap().state, "queued");
        assert_eq!(std::fs::read(app.job_dir(&job.id).join("clips/user_raw.mp4")).unwrap(), b"raw footage");
    }

    #[tokio::test]
    async fn shutdown_leaves_queued_work_for_the_next_start() {
        let (_root, app, mut job) = job_fixture();
        job.state = "queued".into();
        app.save_job(&job).unwrap();
        assert_eq!(shutdown_server(State(app.clone())).await, StatusCode::ACCEPTED);
        pipeline::run_job(&app, &job.id).await;
        assert_eq!(app.load_job(&job.id).unwrap().state, "queued");
        assert!(app.begin_job_mutation().is_err());
    }

    #[tokio::test]
    async fn completed_job_reports_its_cover_only_when_the_file_exists() {
        let (_root, app, job) = job_fixture();
        let details = || get_job(State(app.clone()), UrlPath(job.id.clone()));
        let Json(before) = details().await.unwrap_or_else(|e| panic!("{}", e.0));
        assert_eq!(serde_json::to_value(before).unwrap()["cover_ready"], false);

        std::fs::write(app.job_dir(&job.id).join("cover.jpg"), b"cover file").unwrap();
        let Json(after) = details().await.unwrap_or_else(|e| panic!("{}", e.0));
        assert_eq!(serde_json::to_value(after).unwrap()["cover_ready"], true);
    }

    #[test]
    fn accepts_only_shopee_https_links() {
        assert!(shopee_url("https://shopee.co.th/x-i.201488045.54906356824").is_some());
        assert!(shopee_url("https://shp.ee/abc").is_some());
        assert!(shopee_url("http://shopee.co.th/x").is_none());
        assert!(shopee_url("https://evil.example/shopee.co.th").is_none());
        assert!(shopee_url("https://shopee.co.th.evil.example/").is_none());
    }

    #[test]
    fn finds_item_id_in_both_link_shapes() {
        let id = |s| item_id(&reqwest::Url::parse(s).unwrap());
        assert_eq!(id("https://shopee.co.th/name-i.201488045.54906356824?x=1").as_deref(), Some("54906356824"));
        assert_eq!(id("https://shopee.co.th/product/201488045/6439091330").as_deref(), Some("6439091330"));
        assert_eq!(id("https://shp.ee/abc"), None);
    }

    #[test]
    fn file_names_cannot_escape_their_folder() {
        assert_eq!(safe_name("../../etc/passwd"), "etcpasswd");
        assert_eq!(safe_name("IMG_9074.mov"), "IMG_9074.mov");
    }
}
