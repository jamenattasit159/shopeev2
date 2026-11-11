//! One job, six stages. Each stage writes its result to the job folder, so a failed or
//! interrupted job resumes from the stage that is missing its output.
use crate::{llm, plan, App, Job, Product};
use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const MAX_IMAGES: usize = 6;
const MAX_DOWNLOAD: usize = 80 * 1024 * 1024;
pub const COVER_FILE: &str = "cover.jpg";

pub async fn run_job(app: &App, id: &str) {
    let mut job = {
        let Ok(_mutation) = app.begin_job_mutation() else { return };
        let Ok(mut job) = app.load_job(id) else { return };
        if !matches!(job.state.as_str(), "queued" | "running") {
            return;
        }
        job.state = "running".into();
        job.error.clear();
        if app.save_job(&job).is_err() {
            return;
        }
        job
    };
    let result = if job.kind == crate::story::KIND { crate::story::stages(app, &mut job).await } else { stages(app, &mut job).await };
    match result {
        // a story job sets its own state (review / done)
        Ok(()) if job.state != "running" => {}
        Ok(()) => {
            job.state = "done".into();
            job.stage = "เสร็จแล้ว".into();
        }
        Err(e) => {
            job.state = "error".into();
            job.error = format!("{e:#}");
        }
    }
    let _ = app.save_job(&job);
}

async fn stages(app: &App, job: &mut Job) -> Result<()> {
    let dir = app.job_dir(&job.id);
    let product: Product = serde_json::from_str(&std::fs::read_to_string(dir.join("product.json"))?)?;
    let step = |job: &mut Job, name: &str| {
        job.stage = name.to_string();
        app.save_job(job)
    };

    step(job, "1/6 เตรียมรูปและคลิป")?;
    let assets = assets(app, &dir, &product).await?;

    step(job, "2/6 AI เขียนสคริปต์")?;
    let plan = direct(app, job, &dir, &product, !assets.clips.is_empty()).await?;

    step(job, "3/6 พากย์เสียง")?;
    let seconds = voice(app, &dir, &plan).await?;

    step(job, "4/6 จัดเวลา")?;
    job.seconds = timeline(app, job, &dir, &plan, &assets, &seconds)?;
    if !(13.0..=24.0).contains(&job.seconds) {
        job.warnings.push(format!("คลิปยาว {:.1} วินาที อยู่นอกช่วง 15-22 วินาที", job.seconds));
    }

    step(job, "5/6 เรนเดอร์ (2-3 นาที)")?;
    let out = dir.join("out.mp4");
    node(
        &app.root,
        &[
            "node_modules/@remotion/cli/remotion-cli.js", "render", "src/index.tsx", "Clip",
            &out.to_string_lossy(),
            &format!("--props={}", dir.join("props.json").to_string_lossy()),
            &format!("--public-dir={}", dir.join("pub").to_string_lossy()),
            "--log=error", "--crf=20",
        ],
        &[],
    )
    .await
    .context("เรนเดอร์ไม่สำเร็จ")?;
    anyhow::ensure!(out.exists(), "เรนเดอร์จบแต่ไม่มีไฟล์ mp4");

    step(job, "6/6 ส่งออก")?;
    let caption = format!("{}\n\n{}\n\n{}\n", plan.caption.trim(), plan.hashtags.join(" "), job.url);
    std::fs::write(dir.join("caption.txt"), &caption)?;
    let export = app.root.join(&app.cfg.read().await.export_dir);
    std::fs::create_dir_all(&export)?;
    std::fs::copy(&out, export.join(format!("{}.mp4", job.id)))?;
    std::fs::write(export.join(format!("{}.txt", job.id)), caption)?;
    if let Err(error) = cover(&app.root, &dir, &export, &job.id).await {
        job.warnings.push(format!("สร้างปกไม่สำเร็จ: {error:#}"));
    }
    Ok(())
}

async fn cover(root: &Path, dir: &Path, export: &Path, id: &str) -> Result<()> {
    let props_file = dir.join("props.json");
    let props: Value = serde_json::from_str(&std::fs::read_to_string(&props_file)?)?;
    let public = dir.join("pub");
    let temp = dir.join("cover.next.jpg");
    if temp.exists() {
        std::fs::remove_file(&temp)?;
    }
    let photo = props["cutout"].as_str().or_else(|| props["images"][0].as_str());
    let mut still_error = None;
    if photo.is_some_and(|src| public.join(src).is_file()) {
        still_error = node(root, &[
            "node_modules/@remotion/cli/remotion-cli.js", "still", "src/index.tsx", "Cover",
            &temp.to_string_lossy(), &format!("--props={}", props_file.display()),
            &format!("--public-dir={}", public.display()), "--image-format=jpeg", "--jpeg-quality=90", "--log=error",
        ], &[]).await.err();
    }
    if still_error.is_some() || !temp.is_file() {
        // Use a settled frame from the opening beat when the job has footage only.
        let first_beat = props["beats"][0]["frames"].as_u64().unwrap_or(30);
        let seek = format!("{:.3}", first_beat.saturating_sub(8) as f64 / 30.0);
        sh("ffmpeg", &[
            "-v", "error", "-y", "-ss", &seek, "-i", &dir.join("out.mp4").to_string_lossy(),
            "-frames:v", "1", "-q:v", "2", &temp.to_string_lossy(),
        ], root, &[]).await.with_context(|| match still_error {
            Some(error) => format!("ดึงเฟรมจากคลิปไม่ได้หลังเรนเดอร์ปกล้มเหลว ({error:#})"),
            None => "ดึงเฟรมจากคลิปไม่ได้".into(),
        })?;
    }
    let staged_export = export.join(format!(".{id}-cover.next.jpg"));
    std::fs::copy(&temp, &staged_export)?;
    std::fs::rename(staged_export, export.join(format!("{id}-cover.jpg")))?;
    std::fs::rename(temp, dir.join(COVER_FILE))?;
    Ok(())
}

/// Runs a program and returns stdout; on failure the error carries the tail of stderr.
pub(crate) async fn sh(program: &str, args: &[&str], cwd: &Path, envs: &[(&str, &str)]) -> Result<String> {
    let out = tokio::process::Command::new(program)
        .args(args)
        .current_dir(cwd)
        .envs(envs.iter().copied())
        .kill_on_drop(true)
        .output()
        .await
        .with_context(|| format!("เรียกโปรแกรม {program} ไม่ได้"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let tail: String = err.chars().rev().take(600).collect::<String>().chars().rev().collect();
        return Err(anyhow!("{program} ล้มเหลว (code {:?}): {tail}", out.status.code()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Runs a script from the render/ package.
pub async fn node(root: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<String> {
    sh("node", args, &root.join("render"), envs).await
}

pub(crate) async fn duration(file: &Path) -> Result<f64> {
    let out = sh("ffprobe", &["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", &file.to_string_lossy()], Path::new("."), &[]).await?;
    Ok(out.trim().parse()?)
}

pub struct Assets {
    pub(crate) images: Vec<String>,
    cutout: Option<String>,
    /// (path relative to pub/, seconds)
    clips: Vec<(String, f64)>,
}

/// Shopee serves product media from these; nothing else is ever fetched.
fn allowed_media(url: &str) -> bool {
    reqwest::Url::parse(url).ok().is_some_and(|u| {
        let h = u.host_str().unwrap_or("");
        u.scheme() == "https" && (h.ends_with(".susercontent.com") || h.ends_with(".shopee.co.th") || h.ends_with(".shopee.com"))
    })
}

pub fn gallery_images(product: &Product) -> Result<Vec<String>> {
    anyhow::ensure!(product.gallery_schema == 1,
        "อัปเดตส่วนขยาย Shopee Clip เป็น 0.1.2 แล้วรีเฟรชหน้าสินค้าเพื่อรับรูปใหม่");
    let mut images = Vec::new();
    for raw in &product.images {
        let Ok(mut url) = reqwest::Url::parse(raw) else { continue };
        if url.scheme() != "https" || !url.host_str().is_some_and(|host| host.ends_with(".susercontent.com")) {
            continue;
        }
        let Some(file) = url.path().strip_prefix("/file/") else { continue };
        let file = file.split('@').next().unwrap_or_default();
        let file = file.strip_suffix("_tn").unwrap_or(file);
        // Defense in depth for the account image and campaign overlays observed in legacy jobs.
        if file.is_empty() || !file.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
            || matches!(file, "th-11134233-7rask-m18mbabunhdfa5" | "th-11134258-81ztk-mv4h6a7ae8eh6d" | "th-11134258-7r98z-lza9f5c8o71l63") {
            continue;
        }
        url.set_path(&format!("/file/{file}"));
        url.set_query(None);
        url.set_fragment(None);
        let clean = url.to_string();
        if !images.contains(&clean) {
            images.push(clean);
            if images.len() == MAX_IMAGES * 2 { break; }
        }
    }
    anyhow::ensure!(!images.is_empty(), "ยังไม่พบรูปจากแกลเลอรีสินค้า เปิดหน้าสินค้าแล้วกดส่งข้อมูลใหม่");
    Ok(images)
}

pub fn has_verified_gallery(dir: &Path) -> bool {
    std::fs::read(dir.join("product.json")).ok()
        .and_then(|raw| serde_json::from_slice::<Product>(&raw).ok())
        .is_some_and(|product| gallery_images(&product).is_ok())
}

fn remove_cached_file(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

async fn download(url: &str, to: &Path) -> Result<()> {
    anyhow::ensure!(allowed_media(url), "ไม่ใช่ที่อยู่ไฟล์ของ Shopee");
    let res = reqwest::Client::new().get(url).timeout(std::time::Duration::from_secs(90)).send().await?.error_for_status()?;
    let bytes = res.bytes().await?;
    anyhow::ensure!(bytes.len() <= MAX_DOWNLOAD, "ไฟล์ใหญ่เกิน 80MB");
    std::fs::write(to, &bytes)?;
    Ok(())
}

pub(crate) async fn assets(app: &App, dir: &Path, product: &Product) -> Result<Assets> {
    let gallery = gallery_images(product)?;
    let shop_video = product.videos.first().filter(|url| allowed_media(url));
    let pubdir = dir.join("pub");
    let adir = pubdir.join("assets");
    let clips_dir = dir.join("clips");
    std::fs::create_dir_all(&adir)?;
    std::fs::create_dir_all(&clips_dir)?;
    let here = Path::new(".");

    // The cache must match the verified gallery; legacy fetched markers cannot vouch for media.
    let cache_path = adir.join("gallery-cache.json");
    let gallery_key = json!({"images": gallery, "video": shop_video});
    let cached = std::fs::read(&cache_path).ok().and_then(|raw| serde_json::from_slice::<Value>(&raw).ok());
    if cached.as_ref() != Some(&gallery_key) || !(0..MAX_IMAGES).any(|i| adir.join(format!("img{i}.png")).is_file()) {
        remove_cached_file(&cache_path)?;
        for i in 0..MAX_IMAGES {
            remove_cached_file(&adir.join(format!("img{i}.png")))?;
        }
        remove_cached_file(&adir.join("cut.png"))?;
        remove_cached_file(&adir.join("clip_shop_0.mp4"))?;
        remove_cached_file(&clips_dir.join("shop_0.mp4"))?;
        let mut n = 0;
        for url in &gallery {
            if n == MAX_IMAGES {
                break;
            }
            let raw = adir.join("raw.bin");
            let png = adir.join(format!("img{n}.png"));
            // one bad photo must not sink the job; a job with no photo at all fails below
            let ok = download(url, &raw).await.is_ok()
                && sh("ffmpeg", &["-v", "error", "-y", "-i", &raw.to_string_lossy(), "-vf", "scale='min(1400,iw)':-2", "-frames:v", "1", &png.to_string_lossy()], here, &[]).await.is_ok();
            if ok {
                n += 1;
            } else {
                remove_cached_file(&png)?;
            }
            let _ = std::fs::remove_file(&raw);
        }
        if let Some(v) = shop_video {
            let _ = download(v, &clips_dir.join("shop_0.mp4")).await;
        }
        for i in 0..n.min(3) {
            let (img, cut) = (adir.join(format!("img{i}.png")), adir.join("cut.png"));
            // exit code 3 = cutout rejected (infographic-style photo); try the next one
            if node(&app.root, &["cutout.mjs", &img.to_string_lossy(), &cut.to_string_lossy()], &[]).await.is_ok() {
                break;
            }
        }
        if n > 0 {
            std::fs::write(&cache_path, serde_json::to_vec(&gallery_key)?)?;
        }
    }

    // Clips can be added later by the user, so normalise whatever is new on every run.
    let mut sources: Vec<PathBuf> = std::fs::read_dir(&clips_dir)?.flatten().map(|e| e.path()).collect();
    sources.sort(); // "shop_" sorts before "user_"; reversed below so the owner's footage is used first
    sources.reverse();
    let mut clips = Vec::new();
    for src in sources {
        let stem = src.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let out = adir.join(format!("clip_{stem}.mp4"));
        if !out.exists() {
            // shortcut: centre-crops landscape footage to 9:16 and keeps the first 20 s; upgrade if shop videos lose the product at the edges
            let vf = "fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
            let done = sh("ffmpeg", &["-v", "error", "-y", "-t", "20", "-i", &src.to_string_lossy(), "-vf", vf, "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-g", "15", "-pix_fmt", "yuv420p", &out.to_string_lossy()], here, &[]).await;
            if done.is_err() {
                let _ = std::fs::remove_file(&out);
                continue;
            }
        }
        if let Ok(d) = duration(&out).await {
            if d >= 1.5 {
                clips.push((format!("assets/clip_{stem}.mp4"), d));
            }
        }
    }

    let images: Vec<String> = (0..MAX_IMAGES).filter(|i| adir.join(format!("img{i}.png")).exists()).map(|i| format!("assets/img{i}.png")).collect();
    if images.is_empty() && clips.is_empty() {
        bail!("ไม่มีรูปหรือคลิปของสินค้าให้ใช้เลย (ดาวน์โหลดรูปจากหน้าสินค้าไม่ได้)");
    }
    let cutout = adir.join("cut.png").exists().then(|| "assets/cut.png".to_string());
    Ok(Assets { images, cutout, clips })
}

pub(crate) fn banned_words(root: &Path) -> Vec<String> {
    let raw = std::fs::read_to_string(root.join("render/data/banned-claims.json")).unwrap_or_default();
    let v: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
    v["bannedWords"].as_array().map(|a| a.iter().filter_map(|w| w.as_str().map(String::from)).collect()).unwrap_or_default()
}

async fn direct(app: &App, job: &mut Job, dir: &Path, product: &Product, has_clips: bool) -> Result<plan::Plan> {
    let file = dir.join("plan.json");
    if let Ok(raw) = std::fs::read_to_string(&file) {
        return Ok(serde_json::from_str(&raw)?);
    }
    let style = plan::STYLES
        .iter()
        .find(|s| s.0 == job.style)
        .copied()
        .unwrap_or(plan::STYLES[(job.seed % plan::STYLES.len() as u64) as usize]);
    job.style = style.0.to_string();
    let source: String = format!("{}\n{}", product.title, product.text).chars().take(7000).collect();
    let base = plan::prompt(style, &product.title, &source, has_clips);
    let banned = banned_words(&app.root);
    let cfg = app.cfg.read().await.clone();

    let mut failures = Vec::new();
    for provider in &cfg.director {
        let mut prompt = base.clone();
        // two correction rounds per provider, then move on to the next in the fallback order
        for _ in 0..3 {
            let (problems, previous_plan) = match llm::complete(provider, &cfg, &prompt).await {
                Err(e) => {
                    failures.push(format!("{provider}: {e:#}"));
                    break;
                }
                Ok(reply) => match plan::parse(&reply) {
                    Err(e) => (vec![e], None),
                    Ok(p) => {
                        let errs = plan::validate(&p, &source, &banned);
                        if errs.is_empty() {
                            std::fs::write(&file, serde_json::to_string_pretty(&p)?)?;
                            job.provider = provider.clone();
                            return Ok(p);
                        }
                        (errs, Some(serde_json::to_string(&p)?))
                    }
                },
            };
            failures.push(format!("{provider}: {}", problems.join("; ")));
            prompt = format!("{base}\n\nคำตอบรอบก่อนผิดกฎต่อไปนี้ ให้แก้แล้วตอบ JSON ใหม่ทั้งหมด:\n- {}", problems.join("\n- "));
            if let Some(previous_plan) = previous_plan {
                prompt.push_str(&format!("\n\nJSON รอบก่อนสำหรับใช้แก้:\n{previous_plan}"));
            }
        }
    }
    bail!("AI เขียนสคริปต์ที่ผ่านกฎไม่ได้: {}", failures.join(" | "))
}

async fn voice(app: &App, dir: &Path, plan: &plan::Plan) -> Result<Vec<f64>> {
    let audio = dir.join("pub").join("audio");
    let done = audio.join("durations.json");
    if let Ok(raw) = std::fs::read_to_string(&done) {
        return Ok(serde_json::from_str(&raw)?);
    }
    let cfg = app.cfg.read().await.clone();
    anyhow::ensure!(!cfg.keys.gemini.is_empty(), "เสียงพากย์ต้องใช้ Gemini API key ใส่ได้ในหน้าตั้งค่า");
    let req = dir.join("tts-request.json");
    let lines: Vec<&str> = plan.beats.iter().map(|b| b.say.as_str()).collect();
    std::fs::write(&req, json!({"lines": lines, "voice": cfg.voice, "outDir": audio, "cacheDir": app.root.join("jobs").join(".tts-cache")}).to_string())?;
    let out = node(&app.root, &["node_modules/tsx/dist/cli.mjs", "tts.ts", &req.to_string_lossy()], &[("GEMINI_API_KEY", cfg.keys.gemini.as_str())])
        .await
        .context("สร้างเสียงพากย์ไม่สำเร็จ")?;
    let parsed: Value = serde_json::from_str(out.trim().lines().last().unwrap_or("")).context("ตัวพากย์เสียงตอบกลับผิดรูปแบบ")?;
    let seconds: Vec<f64> = parsed.as_array().map(|a| a.iter().filter_map(|x| x["seconds"].as_f64()).collect()).unwrap_or_default();
    anyhow::ensure!(seconds.len() == plan.beats.len(), "ได้เสียงไม่ครบทุกประโยค");
    std::fs::write(&done, serde_json::to_string(&seconds)?)?;
    Ok(seconds)
}

/// Turns voice lengths into frame positions, hands footage to the scenes that show it, writes props.json.
fn timeline(app: &App, job: &Job, dir: &Path, plan: &plan::Plan, assets: &Assets, seconds: &[f64]) -> Result<f64> {
    let pubdir = dir.join("pub");
    let last = plan.beats.len() - 1;
    let mut from = 0u32;
    let mut cursor = vec![0f64; assets.clips.len()];
    let (mut next_clip, mut next_image) = (0usize, 0usize);
    let mut beats = Vec::new();
    for (i, (b, secs)) in plan.beats.iter().zip(seconds).enumerate() {
        let frames = plan::beat_frames(*secs, i == last);
        let len = frames as f64 / 30.0;
        let wants_footage = matches!(b.scene.as_str(), "hook" | "bigword" | "count");
        let media = if wants_footage && !assets.clips.is_empty() {
            let k = next_clip % assets.clips.len();
            next_clip += 1;
            let (src, total) = &assets.clips[k];
            if cursor[k] + len > *total {
                cursor[k] = 0.0; // ran out of fresh footage: start this clip again
            }
            let start = cursor[k];
            cursor[k] += len;
            json!({"type": "video", "src": src, "startFrom": (start * 30.0).round() as u32})
        } else if b.scene == "count" && !assets.images.is_empty() {
            next_image += 1;
            json!({"type": "image", "src": assets.images[next_image % assets.images.len()]})
        } else {
            Value::Null
        };
        beats.push(json!({
            "scene": b.scene, "say": b.say, "text": b.text, "badges": b.badges, "number": b.number, "unit": b.unit,
            "from": from, "frames": frames, "audio": format!("audio/{i}.wav"), "media": media,
        }));
        from += frames;
    }

    // sound effects and music live inside the job's public folder so the renderer can reach them
    let sfx = pubdir.join("sfx");
    std::fs::create_dir_all(&sfx)?;
    for f in std::fs::read_dir(app.root.join("render/public/sfx"))?.flatten() {
        std::fs::copy(f.path(), sfx.join(f.file_name()))?;
    }
    let tracks: Vec<PathBuf> = std::fs::read_dir(app.root.join("bgm"))
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| matches!(p.extension().and_then(|e| e.to_str()), Some("mp3" | "m4a" | "wav")))
        .collect();
    let bgm = match tracks.get((job.seed as usize) % tracks.len().max(1)) {
        Some(t) => {
            let name = format!("bgm.{}", t.extension().unwrap_or_default().to_string_lossy());
            std::fs::copy(t, pubdir.join(&name))?;
            Value::String(name)
        }
        None => Value::Null,
    };

    let props = json!({
        "seed": job.seed % 1000,
        "palette": plan::PALETTES[(job.seed % plan::PALETTES.len() as u64) as usize],
        "product": {"name": job.title, "brand": plan.product.brand, "price": plan.product.price, "priceBefore": plan.product.price_before, "rating": plan.product.rating},
        "cutout": assets.cutout, "images": assets.images, "bgm": bgm, "beats": beats, "totalFrames": from,
    });
    std::fs::write(dir.join("props.json"), serde_json::to_string_pretty(&props)?)?;
    Ok(from as f64 / 30.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_legacy_gallery_and_filters_profile_images_even_in_verified_gallery() {
        let mut product = Product {
            images: vec![
                "https://down-th.img.susercontent.com/file/th-11134233-7rask-m18mbabunhdfa5_tn?size=100".into(),
                "https://down-th.img.susercontent.com/file/th-11134258-7r98z-lza9f5c8o71l63@resize_w82".into(),
                "https://down-th.img.susercontent.com/file/th-11134207-7rasj-m4a4v3vtgtsad5".into(),
            ],
            ..Product::default()
        };
        assert!(gallery_images(&product).is_err());
        product.gallery_schema = 1;
        assert_eq!(gallery_images(&product).unwrap(), ["https://down-th.img.susercontent.com/file/th-11134207-7rasj-m4a4v3vtgtsad5"]);
    }

    #[test]
    fn only_shopee_media_hosts_are_fetched() {
        assert!(allowed_media("https://down-th.img.susercontent.com/file/abc"));
        assert!(allowed_media("https://cv.shopee.co.th/file/abc.mp4"));
        assert!(!allowed_media("http://down-th.img.susercontent.com/file/abc"));
        assert!(!allowed_media("https://susercontent.com.evil.example/a"));
        assert!(!allowed_media("https://127.0.0.1/secret"));
    }
}
