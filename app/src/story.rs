//! Story Ad: a "survival rule" 3D story that ends on the product (see docs/superpowers/specs/2026-11-11-story-ad-design.md).
//! A story job runs straight to a draft, then waits in state "review". The draft is kept as one video file per SCENE
//! (one voice line), so a scene can be changed and re-rendered alone; "export" joins them and ships the clip.
use crate::{llm, need, pipeline, Api, App, Job, Product, Shared};
use anyhow::{anyhow, bail, Context, Result};
use axum::{
    extract::{Path as UrlPath, State},
    http::header,
    response::Html,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const KIND: &str = "story";
const MAX_SPOKEN: usize = 620; // the 676-character sample came out at 57 s; this keeps a clip under a minute
const TWIST: &str = "ยกเว้นเรื่องเดียว";
const SHOTS: [&str; 12] = ["subject", "subject-close", "top", "face", "wide", "pet", "pet-subject", "aux", "product", "product-open", "photo", "price"];
const YOU_POSES: [&str; 7] = ["rest", "sleepy", "look", "reach", "dig", "shock", "relief"];
const PET_POSES: [&str; 3] = ["stare", "calm", "sleep"];
const CARDS: [&str; 6] = ["rule", "tag", "clock", "proof", "photo", "price"];
/// state keys per set: (key, what it shows). The AI may only use these.
const KITCHEN_STATE: [(&str, &str); 7] = [
    ("lid", "ฝาของภาชนะบนเคาน์เตอร์: \"ajar\" (เผยอ ค่าเริ่มต้น), \"on\" (ปิดสนิท), \"off\" (เปิดออกวางข้างๆ)"),
    ("scoop", "true = มีช้อนจมอยู่ในผง (เห็นเมื่อ lid เป็น off)"),
    ("clump", "0..1 = ผงจับเป็นก้อน (เห็นเมื่อ lid เป็น off)"),
    ("cup", "true = มีแก้วน้ำบนเคาน์เตอร์"),
    ("lumps", "true = มีก้อนผงลอยในแก้ว"),
    ("cold", "0..1 = แสงเย็นแบบแสงจันทร์ ใช้ตอนหักมุม"),
    ("product", "true = สินค้าวางอยู่บนเคาน์เตอร์แทนภาชนะเดิม (ใช้กับ shot wide/face หลังเปิดตัวสินค้า)"),
];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Cut {
    pub shot: String,
    pub you: Option<String>,
    pub pet: Option<String>,
    #[serde(rename = "noPet")]
    pub no_pet: Option<bool>,
    pub state: Option<serde_json::Map<String, Value>>,
    pub card: Option<Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Row {
    /// Thai voice line, phrases separated by spaces, numbers written as words
    pub vo: String,
    /// English subtitle
    pub sub: String,
    pub cuts: Vec<Cut>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Script {
    pub title: String,
    /// the "don't ..." part, a few words, shown on the rule sign
    pub rule: String,
    /// the "if ..." part
    #[serde(rename = "ruleLabel")]
    pub rule_label: String,
    pub red: Vec<String>,
    pub amb: Vec<String>,
    pub brand: String,
    #[serde(rename = "endLine")]
    pub end_line: String,
    pub rows: Vec<Row>,
    /// what the story is about, for the owner
    pub explain: String,
    /// claims with numbers that did not come from the product page: the owner must check them
    pub unverified: Vec<String>,
    pub caption: String,
    pub hashtags: Vec<String>,
}

fn digits(s: &str) -> Vec<String> {
    let clean: String = s.chars().filter(|c| *c != ',').collect();
    clean.split(|c: char| !c.is_ascii_digit()).filter(|r| !r.is_empty()).map(String::from).collect()
}

fn check_cut(c: &Cut, at: &str, source_digits: &str, errs: &mut Vec<String>) {
    if !SHOTS.contains(&c.shot.as_str()) {
        errs.push(format!("{at}: ไม่มี shot \"{}\" ในคลัง", c.shot));
    }
    if c.you.as_deref().is_some_and(|p| !YOU_POSES.contains(&p)) {
        errs.push(format!("{at}: ไม่มีท่า you นี้ในคลัง"));
    }
    if c.pet.as_deref().is_some_and(|p| !PET_POSES.contains(&p)) {
        errs.push(format!("{at}: ไม่มีท่า pet นี้ในคลัง"));
    }
    for key in c.state.iter().flat_map(|m| m.keys()) {
        if !KITCHEN_STATE.iter().any(|(k, _)| k == key) {
            errs.push(format!("{at}: ฉากนี้ไม่มี state \"{key}\""));
        }
    }
    if let Some(card) = &c.card {
        let kind = card["type"].as_str().unwrap_or("");
        if !CARDS.contains(&kind) {
            errs.push(format!("{at}: ไม่มี card \"{kind}\" ในคลัง"));
        }
        if kind == "price" {
            let amount = card["amount"].as_str().unwrap_or("");
            if amount.is_empty() || digits(amount).iter().any(|d| !source_digits.contains(d.as_str())) {
                errs.push(format!("{at}: ราคา \"{amount}\" ไม่มีในข้อมูลสินค้า"));
            }
        }
        if kind == "photo" && card["src"].as_str().is_some_and(|s| !is_photo_name(s)) {
            errs.push(format!("{at}: card photo ต้องใช้ src เป็น product.png หรือ img1.png ถึง img5.png"));
        }
    }
}

fn is_photo_name(s: &str) -> bool {
    s == "product.png" || (1..=5).any(|i| s == format!("img{i}.png"))
}

/// Every rule a story script breaks. `source` is the text scraped from the product page.
pub fn validate(s: &Script, source: &str, banned: &[String]) -> Vec<String> {
    let mut errs = Vec::new();
    let n = s.rows.len();
    if !(12..=16).contains(&n) {
        errs.push(format!("ต้องมี 12-16 แถว แต่ได้ {n}"));
    }
    let spoken: usize = s.rows.iter().map(|r| r.vo.chars().count()).sum();
    if spoken > MAX_SPOKEN {
        errs.push(format!("บทพากย์รวมยาว {spoken} ตัวอักษร ต้องไม่เกิน {MAX_SPOKEN}"));
    }
    if let Some(first) = s.rows.first() {
        const NUMBER_WORDS: [&str; 14] = ["หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า", "สิบ", "ร้อย", "ตี", "เที่ยง", "ครึ่ง"];
        if !first.vo.trim_start().starts_with("ถ้า") || !first.vo.contains("อย่า") {
            errs.push("แถว 1 ต้องเป็นกฎ \"ถ้า... อย่า...\"".into());
        }
        if !NUMBER_WORDS.iter().any(|w| first.vo.contains(w)) {
            errs.push("แถว 1 ต้องมีตัวเลขหรือเวลา (เขียนเป็นคำ)".into());
        }
    }
    let twist = s.rows.iter().position(|r| r.vo.contains(TWIST));
    if twist.is_none() {
        errs.push(format!("ต้องมีแถว \"คุณทำถูกทุกอย่าง {TWIST}\" เป็นแถวของตัวเอง"));
    }
    if s.rule.trim().is_empty() || s.rule_label.trim().is_empty() || s.title.trim().is_empty() {
        errs.push("ต้องมี title, rule และ ruleLabel".into());
    }
    let source_digits: String = source.chars().filter(|c| *c != ',').collect();
    for (i, r) in s.rows.iter().enumerate() {
        let at = format!("แถว {}", i + 1);
        if r.vo.trim().is_empty() || r.sub.trim().is_empty() {
            errs.push(format!("{at}: ต้องมีทั้ง vo และ sub"));
        }
        if r.vo.chars().any(|c| c.is_ascii_digit()) {
            errs.push(format!("{at}: ตัวเลขใน vo ต้องเขียนเป็นคำไทย"));
        }
        if r.vo.contains('|') || r.sub.contains('|') {
            errs.push(format!("{at}: ห้ามมีเครื่องหมาย |"));
        }
        if !(1..=2).contains(&r.cuts.len()) {
            errs.push(format!("{at}: ต้องมี 1-2 cuts"));
        }
        let forbidden = banned.iter().map(String::as_str).chain(["บัว"]).find(|w| !w.is_empty() && (r.vo.contains(w) || r.sub.contains(w)));
        if let Some(w) = forbidden {
            errs.push(format!("{at}: มีคำต้องห้าม \"{w}\""));
        }
        for c in &r.cuts {
            check_cut(c, &at, &source_digits, &mut errs);
            let shows_product = matches!(c.shot.as_str(), "product" | "product-open" | "price")
                || c.state.as_ref().is_some_and(|m| m.get("product").is_some_and(|v| v == &json!(true)));
            if shows_product && twist.is_none_or(|t| i <= t) {
                errs.push(format!("{at}: สินค้าต้องเข้าหลังแถวหักมุมเท่านั้น"));
            }
        }
    }
    errs
}

/// Replaces one scene's cuts, leaving every other scene exactly as it was.
pub fn replace_scene(s: &mut Script, scene: usize, cuts: Vec<Cut>) -> Result<()> {
    let row = s.rows.get_mut(scene.wrapping_sub(1)).ok_or_else(|| anyhow!("ไม่มีฉากที่ {scene}"))?;
    row.cuts = cuts;
    Ok(())
}

fn library_doc() -> String {
    let states: Vec<String> = KITCHEN_STATE.iter().map(|(k, d)| format!("  - {k}: {d}")).collect();
    format!(
        r##"คลังที่ใช้ได้ (ห้ามใช้ค่านอกเหนือจากนี้):
ฉาก: ครัวตอนกลางคืน "คุณ" ยืนหลังเคาน์เตอร์หันหน้าเข้ากล้อง บนเคาน์เตอร์มีภาชนะหนึ่งใบ (ของสำคัญของเรื่อง) และแมวส้มนั่งข้างๆ
shot:
  - subject: ภาชนะบนเคาน์เตอร์ ระยะกลาง
  - subject-close: โคลสอัพที่ฝาภาชนะ (ใช้เฉลยจุดหักมุม)
  - top: มองลงเข้าไปในภาชนะ (ต้อง lid เป็น off)
  - face: หน้าของคุณ
  - wide: ทั้งครัว เห็นคุณ แมว และเคาน์เตอร์
  - pet: แมว
  - pet-subject: แมวกับภาชนะในเฟรมเดียว
  - aux: แก้วน้ำบนเคาน์เตอร์ (ต้อง state cup เป็น true)
  - product: สินค้าวางบนเคาน์เตอร์
  - product-open: สินค้ากำลังเปิดฝา
  - photo: รูปสินค้าจริงจากร้าน ต้องมี card แบบ photo
  - price: รูปสินค้าจริงพร้อมป้ายราคา ต้องมี card แบบ price
ท่า you: {you}
ท่า pet: {pet}
state (ใส่ใน "state" ของ cut ต้องใส่ซ้ำทุก cut ที่อยากให้เห็น ไม่จำค่าข้าม cut):
{states}
card:
  - {{"type":"rule"}} ป้ายกฎ ใช้ใน cut แรกของแถว 1
  - {{"type":"tag"}} ป้ายกฎเล็ก
  - {{"type":"clock","t":"02:05","label":"ในครัว"}} นาฬิกามุมจอ
  - {{"type":"proof","title":"...","big":"4","unit":"สัปดาห์","note":"...","source":"ที่มา"}} การ์ดข้อเท็จจริง มีตัวเลขใหญ่หนึ่งตัว
  - {{"type":"photo","src":"product.png","label":"คำบรรยายสั้น"}} src เป็น product.png หรือ img1.png ถึง img5.png
  - {{"type":"price","amount":"179"}} ราคาเป็นตัวเลขจากข้อมูลสินค้า"##,
        you = YOU_POSES.join(", "),
        pet = PET_POSES.join(", "),
        states = states.join("\n"),
    )
}

fn script_prompt(title: &str, source: &str, images: usize) -> String {
    format!(
        r##"คุณเป็นคนเขียนบทและผู้กำกับคลิปโฆษณาสั้นแนว "กฎเอาตัวรอด" ความยาวไม่เกิน 55 วินาที เป็นแอนิเมชัน 3 มิติ
เล่าด้วยบุรุษที่สอง ("คุณ") ปัจจุบันกาล ประโยคสั้น เสียงนิ่ง ไม่ขายของจนกว่าจะถึงท้ายเรื่อง

โครงเรื่อง (บังคับ):
1. แถว 1 คือกฎ "ถ้า<สถานการณ์ที่มีตัวเลขหรือเวลา> อย่า<สิ่งที่คนทำตามสัญชาตญาณ>" ต้องเป็นเรื่องที่คนใช้สินค้านี้เจอจริง
2. แถว 2 ขึ้นต้น "เพราะ" ยกเดิมพัน
3. ข้อเท็จจริงหนึ่งข้อที่มีตัวเลข แล้วคุณลงมือทำตามทันที
4. เวลาและสถานที่ เดินไปเรื่อยๆ (เช่น ตีสองห้านาที ในครัว)
5. แมว (ตั้งชื่อไทยสั้นๆ) สังเกตเห็นความผิดปกติก่อนคน
6. คุณทำตามขั้นตอนทีละขั้น ทุกอย่างดูถูกต้อง แต่ผลออกมาผิด
7. แถวของตัวเอง: "คุณทำถูกทุกอย่าง ยกเว้นเรื่องเดียว"
8. เฉลย: รายละเอียดทางกายภาพหนึ่งอย่างที่อยู่ในภาพตั้งแต่ต้น (ตั้งค่าด้วย state ตั้งแต่แถวแรกๆ แล้วใช้ shot subject-close ตอนเฉลย)
9. สินค้าเข้ามาเป็นคำตอบของปัญหานั้น 2-3 แถว พูดเฉพาะคุณสมบัติที่มีในข้อมูลสินค้า แล้วบอกราคาและ "พิกัดอยู่ในตะกร้า"
10. แถวสุดท้ายเป็นประโยคปิดสั้นๆ ที่วนกลับไปที่สถานการณ์ตอนต้น

กฎการเขียน:
- 12-16 แถว แถวละหนึ่งประโยค vo รวมทุกแถวไม่เกิน 600 ตัวอักษร
- vo: คั่นวลีด้วยเว้นวรรค วลีละไม่เกิน 7 คำ ตัวเลขเขียนเป็นคำไทย (สิบเก้า ไม่ใช่ 19) ชื่อยี่ห้อภาษาอังกฤษเขียนเป็นคำอ่านไทย
- sub: คำแปลภาษาอังกฤษเต็มประโยค ใช้ตัวเลขได้
- ห้ามอ้างสรรพคุณทางการแพทย์ ห้ามคำว่า การันตี ดีที่สุด อันดับหนึ่ง และห้ามมีคำว่า "บัว"
- ข้อเท็จจริงที่มีตัวเลขและไม่ได้มาจากข้อมูลสินค้า ให้ใส่ไว้ใน "unverified" ทุกข้อ เพื่อให้เจ้าของตรวจ
- สินค้า (shot product, product-open, price หรือ state product) ใช้ได้เฉพาะแถวหลังแถวหักมุม
- แต่ละแถวมี 1-2 cuts สลับระยะกล้อง อย่าใช้ shot เดิมติดกันเกินสองครั้ง

{library}

มีรูปสินค้าจริง {images} รูป: product.png (รูปหลัก) และ img1.png เป็นต้นไป

ตอบเป็น JSON อย่างเดียว:
{{
  "title": "ชื่อเรื่องสั้นๆ",
  "rule": "ส่วน 'อย่า...' ไม่เกิน 4 คำ",
  "ruleLabel": "ส่วน 'ถ้า...' ไม่เกิน 6 คำ ไม่ต้องมีคำว่าถ้า",
  "red": ["วลีจาก vo ที่ต้องเน้นสีแดง 4-6 วลี ต้องตรงกับวลีใน vo ทุกตัวอักษร"],
  "amb": ["วลีจาก vo ที่เป็นเวลา ตัวเลข ชื่อ 6-10 วลี ตรงทุกตัวอักษร"],
  "brand": "ชื่อยี่ห้อตัวอักษรอังกฤษ ไม่เกิน 12 ตัว",
  "endLine": "ชนิดสินค้า + พิกัดอยู่ในตะกร้า",
  "rows": [{{"vo": "...", "sub": "...", "cuts": [{{"shot": "subject", "you": "rest", "pet": "stare", "state": {{}}, "card": {{"type": "rule"}}}}]}}],
  "explain": "อธิบายเรื่อง: เกี่ยวกับอะไร ทำไมมีกฎนี้ จุดหักมุมคืออะไรและเห็นในภาพตรงไหน",
  "unverified": ["ข้อเท็จจริงที่ต้องตรวจ"],
  "caption": "แคปชันโพสต์ 1-2 ประโยค ไม่มีอีโมจิ",
  "hashtags": ["#..."]
}}

ชื่อสินค้า: {title}

ข้อมูลจากหน้าสินค้า:
{source}"##,
        library = library_doc(),
    )
}

fn parse<T: serde::de::DeserializeOwned>(reply: &str) -> Result<T, String> {
    let (a, b) = (reply.find('{'), reply.rfind('}'));
    let raw = match (a, b) {
        (Some(a), Some(b)) if b > a => &reply[a..=b],
        _ => return Err("คำตอบไม่มี JSON".into()),
    };
    let mut v: Value = serde_json::from_str(raw).map_err(|e| format!("JSON ไม่ถูกรูปแบบ: {e}"))?;
    strip_nulls(&mut v);
    serde_json::from_value(v).map_err(|e| format!("JSON ไม่ถูกรูปแบบ: {e}"))
}

fn strip_nulls(v: &mut Value) {
    match v {
        Value::Object(m) => {
            m.retain(|_, x| !x.is_null());
            m.values_mut().for_each(strip_nulls);
        }
        Value::Array(a) => a.iter_mut().for_each(strip_nulls),
        _ => {}
    }
}

/// Asks the director providers in order; each gets two correction rounds.
async fn ask<T, F>(app: &App, job: &mut Job, base: &str, check: F) -> Result<T>
where
    T: serde::de::DeserializeOwned,
    F: Fn(&T) -> Vec<String>,
{
    let cfg = app.cfg.read().await.clone();
    let mut failures = Vec::new();
    for provider in &cfg.director {
        let mut prompt = base.to_string();
        for _ in 0..3 {
            let problems = match llm::complete(provider, &cfg, &prompt).await {
                Err(e) => {
                    failures.push(format!("{provider}: {e:#}"));
                    break;
                }
                Ok(reply) => match parse::<T>(&reply) {
                    Err(e) => vec![e],
                    Ok(value) => {
                        let errs = check(&value);
                        if errs.is_empty() {
                            job.provider = provider.clone();
                            return Ok(value);
                        }
                        errs
                    }
                },
            };
            failures.push(format!("{provider}: {}", problems.join("; ")));
            prompt = format!("{base}\n\nคำตอบรอบก่อนผิดกฎต่อไปนี้ ให้แก้แล้วตอบ JSON ใหม่ทั้งหมด:\n- {}", problems.join("\n- "));
        }
    }
    bail!("AI ทำงานที่ผ่านกฎไม่ได้: {}", failures.join(" | "))
}

/* ─── files of a story job ─── */
// jobs/story-<id>/
//   product.json, pub/assets/...   same as a clip job
//   story/script.json              the plan (the single source of truth; edits change this)
//   story/script.md, vo/, src/lines.json   what the timing scripts read and write
//   story/segs/seg_NN.mp4|jpg      one rendered scene each
//   story/draft.mp4                all scenes joined + sound

fn sdir(app: &App, id: &str) -> PathBuf {
    app.job_dir(id).join("story")
}
fn load_script(dir: &Path) -> Result<Script> {
    Ok(serde_json::from_str(&std::fs::read_to_string(dir.join("script.json")).context("งานนี้ยังไม่มีบท")?)?)
}
fn save_script(dir: &Path, s: &Script) -> Result<()> {
    std::fs::write(dir.join("script.json"), serde_json::to_string_pretty(s)?)?;
    Ok(())
}

/// script.md in the layout the timing scripts expect: narration block, then the | # | VO | Subtitle | table.
fn script_md(s: &Script) -> String {
    let narration: Vec<String> = s.rows.iter().map(|r| r.vo.replace(' ', "")).collect();
    let rows: Vec<String> = s.rows.iter().enumerate().map(|(i, r)| format!("| {} | {} | {} |", i + 1, r.vo.trim(), r.sub.trim())).collect();
    format!("# EP01 — {}\n\n```\n{}\n```\n\n| # | VO | Subtitle |\n|---|---|---|\n{}\n\n## อธิบายเนื้อเรื่อง\n\n{}\n", s.title, narration.join(" "), rows.join("\n"), s.explain)
}

fn film_json(s: &Script) -> Value {
    let scenes: Vec<Value> = s.rows.iter().enumerate().map(|(i, r)| json!({"line": i + 1, "cuts": r.cuts})).collect();
    json!({"set": "kitchen", "scenes": scenes})
}

fn episode_json(s: &Script) -> Value {
    json!({
        "series": "โฆษณาสินค้า", "ep": 1, "of": 1, "title": s.title, "rule": s.rule, "ruleLabel": s.rule_label, "ruleTagLabel": "กฎ",
        "next": {"ep": s.brand, "line": s.end_line, "follow": "กดสั่งได้เลย"},
        "font": "Kanit", "subtitles": true, "coverFrame": 300, "red": s.red, "amb": s.amb, "color": "#E9B84A", "prev": "",
    })
}

async fn py(app: &App, dir: &Path, script: &str, args: &[&str]) -> Result<String> {
    let file = app.root.join("story/scripts").join(script);
    let mut all = vec![file.to_string_lossy().to_string()];
    all.extend(args.iter().map(|a| a.to_string()));
    let refs: Vec<&str> = all.iter().map(String::as_str).collect();
    // the scripts print Thai; without this Windows consoles make them crash on encoding
    pipeline::sh("python", &refs, dir, &[("PYTHONIOENCODING", "utf-8"), ("PYTHONUTF8", "1")]).await
}

async fn story_node(app: &App, args: &[&str], envs: &[(&str, &str)]) -> Result<String> {
    pipeline::sh("node", args, &app.root.join("story"), envs).await
}

/// Copies this job's plan, timing and photos into the renderer, which builds one job at a time.
fn stage_renderer(app: &App, job: &Job, dir: &Path, s: &Script) -> Result<()> {
    let src = app.root.join("story/src");
    let public = app.root.join("story/public");
    std::fs::write(src.join("film.json"), serde_json::to_string_pretty(&film_json(s))?)?;
    std::fs::write(src.join("episode.json"), serde_json::to_string_pretty(&episode_json(s))?)?;
    std::fs::copy(dir.join("src/lines.json"), src.join("lines.json"))?;
    let custom = dir.join("custom.tsx");
    std::fs::copy(if custom.is_file() { custom } else { src.join("custom.default.tsx") }, src.join("custom.tsx"))?;
    let assets = app.job_dir(&job.id).join("pub/assets");
    for i in 0..6 {
        let from = assets.join(format!("img{i}.png"));
        if from.is_file() {
            std::fs::copy(from, public.join(if i == 0 { "product.png".to_string() } else { format!("img{i}.png") }))?;
        }
    }
    Ok(())
}

async fn render_scenes(app: &App, dir: &Path, scenes: &[usize]) -> Result<()> {
    let segs = dir.join("segs");
    let mut args = vec!["render-scenes.mjs".to_string(), segs.to_string_lossy().to_string()];
    args.extend(scenes.iter().map(|n| n.to_string()));
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = story_node(app, &refs, &[]).await.context("เรนเดอร์ฉากไม่สำเร็จ")?;
    let done: Vec<Value> = serde_json::from_str(out.trim().lines().last().unwrap_or("[]")).context("ตัวเรนเดอร์ตอบกลับผิดรูปแบบ")?;
    // merge into the scene index, replacing only the scenes that were just rendered
    let index = dir.join("scenes.json");
    let mut all: Vec<Value> = std::fs::read_to_string(&index).ok().and_then(|r| serde_json::from_str(&r).ok()).unwrap_or_default();
    for d in done {
        all.retain(|x| x["scene"] != d["scene"]);
        all.push(d);
    }
    all.sort_by_key(|x| x["scene"].as_u64());
    std::fs::write(index, serde_json::to_string(&all)?)?;
    Ok(())
}

/// Joins the scene files and lays voice, room tone and effects under them.
async fn build_draft(app: &App, dir: &Path, s: &Script) -> Result<f64> {
    let list: String = (1..=s.rows.len()).map(|n| format!("file 'segs/seg_{n:02}.mp4'\n")).collect();
    std::fs::write(dir.join("segs.txt"), list)?;
    std::fs::create_dir_all(dir.join("out"))?;
    pipeline::sh("ffmpeg", &["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "segs.txt", "-c", "copy", "out/raw.mp4"], dir, &[]).await.context("ต่อฉากไม่สำเร็จ")?;
    if !dir.join("vo/room.wav").is_file() {
        py(app, dir, "sound.py", &["room", "."]).await?;
    }
    if !dir.join("vo/sfx/impact.wav").is_file() {
        py(app, dir, "sound.py", &["sfx", "vo/sfx"]).await?;
    }
    let twist = s.rows.iter().position(|r| r.vo.contains(TWIST)).map_or(1, |i| i + 1);
    let mix = json!({
        "video": "out/raw.mp4", "voice": "vo/vo_aligned.wav", "out": "draft.mp4",
        "bgm": {"file": "vo/room.wav", "volume": 0.5}, "clicks_volume": 0.9,
        "sfx": [
            {"file": "vo/sfx/riser.wav", "at": format!("L{twist}+0.4"), "volume": 0.5},
            {"file": "vo/sfx/impact.wav", "at": format!("L{}-0.1", (twist + 1).min(s.rows.len())), "volume": 0.7},
        ],
    });
    std::fs::write(dir.join("mix.json"), mix.to_string())?;
    std::fs::write(dir.join("timeline.json"), json!({"acts": {"hook": "L1", "turn": format!("L{twist}"), "hero": format!("L{twist}"), "end": "END"}}).to_string())?;
    py(app, dir, "mix.py", &[]).await.context("ผสมเสียงไม่สำเร็จ")?;
    pipeline::duration(&dir.join("draft.mp4")).await
}

/* ─── the job ─── */

#[derive(Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "lowercase")]
enum Todo {
    Edit { scene: usize, instruction: String },
    Export,
}

pub async fn stages(app: &App, job: &mut Job) -> Result<()> {
    let dir = sdir(app, &job.id);
    std::fs::create_dir_all(dir.join("src"))?;
    let todo_file = dir.join("todo.json");
    let todo: Option<Todo> = std::fs::read_to_string(&todo_file).ok().and_then(|r| serde_json::from_str(&r).ok());
    let result = match todo {
        Some(Todo::Edit { scene, instruction }) => edit_scene(app, job, &dir, scene, &instruction).await,
        Some(Todo::Export) => export(app, job, &dir).await,
        None => draft(app, job, &dir).await,
    };
    let _ = std::fs::remove_file(todo_file);
    // a failed edit must not throw away a reviewable draft: report it and go back to review
    if let (Err(e), true) = (&result, dir.join("draft.mp4").is_file() && job.state != "done") {
        job.warnings.retain(|w| !w.starts_with("แก้ฉากไม่สำเร็จ"));
        job.warnings.push(format!("แก้ฉากไม่สำเร็จ: {e:#}"));
        job.state = "review".into();
        job.stage = "รอตรวจ".into();
        return Ok(());
    }
    result
}

async fn draft(app: &App, job: &mut Job, dir: &Path) -> Result<()> {
    let jdir = app.job_dir(&job.id);
    let product: Product = serde_json::from_str(&std::fs::read_to_string(jdir.join("product.json"))?)?;
    let step = |job: &mut Job, name: &str| {
        job.stage = name.to_string();
        app.save_job(job)
    };

    step(job, "1/6 เตรียมรูป")?;
    let assets = pipeline::assets(app, &jdir, &product).await?;

    step(job, "2/6 AI เขียนบทและวางช็อต")?;
    let script = match load_script(dir) {
        Ok(s) => s,
        Err(_) => {
            let source: String = format!("{}\n{}", product.title, product.text).chars().take(7000).collect();
            let banned = pipeline::banned_words(&app.root);
            let prompt = script_prompt(&product.title, &source, assets.images.len());
            let s: Script = ask(app, job, &prompt, |s: &Script| validate(s, &source, &banned)).await?;
            save_script(dir, &s)?;
            s
        }
    };
    std::fs::write(dir.join("script.md"), script_md(&script))?;
    job.warnings = script.unverified.iter().map(|f| format!("ยังไม่ได้ตรวจ: {f}")).collect();

    step(job, "3/6 พากย์เสียง")?;
    if !dir.join("vo/takeA.mp3").is_file() {
        let cfg = app.cfg.read().await.clone();
        need(!cfg.keys.gemini.is_empty(), "เสียงพากย์ต้องใช้ Gemini API key ใส่ได้ในหน้าตั้งค่า")?;
        story_node(app, &["voice.mjs", &dir.to_string_lossy(), &cfg.voice], &[("GEMINI_API_KEY", cfg.keys.gemini.as_str())]).await.context("พากย์เสียงไม่สำเร็จ")?;
    }

    step(job, "4/6 จับเวลาเสียง")?;
    if !dir.join("src/lines.json").is_file() {
        py(app, dir, "transcribe.py", &["vo/takeA.mp3", "--lang", "th"]).await.context("ถอดเสียงไม่สำเร็จ")?;
        let aligned = py(app, dir, "align.py", &["vo/takeA.mp3"]).await.context("จับคู่เสียงกับบทไม่สำเร็จ")?;
        need(aligned.contains("overlaps: 0"), "จับเวลาเสียงกับบทไม่ลงตัว ลองสร้างใหม่")?;
        // breathe before and after the twist line
        let twist = script.rows.iter().position(|r| r.vo.contains(TWIST)).map_or(0, |i| i + 1);
        std::fs::write(dir.join("vo/pauses.json"), json!({(twist.max(2) - 1).to_string(): 0.7, twist.to_string(): 0.5}).to_string())?;
        py(app, dir, "splice.py", &[]).await.context("จัดเวลาเสียงไม่สำเร็จ")?;
    }

    step(job, "5/6 เรนเดอร์ทีละฉาก")?;
    stage_renderer(app, job, dir, &script)?;
    let missing: Vec<usize> = (1..=script.rows.len()).filter(|n| !dir.join(format!("segs/seg_{n:02}.mp4")).is_file()).collect();
    if !missing.is_empty() {
        render_scenes(app, dir, &missing).await?;
    }

    step(job, "6/6 รวมฉบับร่าง")?;
    job.seconds = build_draft(app, dir, &script).await?;
    if job.seconds > 60.0 {
        job.warnings.push(format!("คลิปยาว {:.1} วินาที เกิน 60 วินาที", job.seconds));
    }
    job.state = "review".into();
    job.stage = "รอตรวจ".into();
    Ok(())
}

fn edit_prompt(row: &Row, scene: usize, instruction: &str) -> String {
    format!(
        r##"นี่คือฉากที่ {scene} ของคลิปโฆษณาแอนิเมชัน 3 มิติ เจ้าของสั่งแก้ ให้แก้เฉพาะภาพของฉากนี้ตามคำสั่ง
บทพากย์ของฉาก (ห้ามเปลี่ยน): {vo}
แผนภาพตอนนี้: {cuts}
คำสั่งแก้จากเจ้าของ: {instruction}

{library}

ตอบเป็น JSON อย่างเดียว: {{"cuts": [ ...1-2 cuts ตามรูปแบบเดิม... ], "note": "สรุปสั้นๆ ว่าแก้อะไร หรือเหตุผลถ้าคำสั่งทำไม่ได้ด้วยคลังนี้"}}"##,
        vo = row.vo,
        cuts = serde_json::to_string(&row.cuts).unwrap_or_default(),
        library = library_doc(),
    )
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct SceneEdit {
    cuts: Vec<Cut>,
    note: String,
}

async fn edit_scene(app: &App, job: &mut Job, dir: &Path, scene: usize, instruction: &str) -> Result<()> {
    let mut script = load_script(dir)?;
    let row = script.rows.get(scene.wrapping_sub(1)).cloned().ok_or_else(|| anyhow!("ไม่มีฉากที่ {scene}"))?;
    job.stage = format!("กำลังแก้ฉากที่ {scene}");
    app.save_job(job)?;
    let jdir = app.job_dir(&job.id);
    let product: Product = serde_json::from_str(&std::fs::read_to_string(jdir.join("product.json"))?)?;
    let source: String = format!("{}\n{}", product.title, product.text).chars().filter(|c| *c != ',').take(7000).collect();
    let twist = script.rows.iter().position(|r| r.vo.contains(TWIST));
    let edit: SceneEdit = ask(app, job, &edit_prompt(&row, scene, instruction), |e: &SceneEdit| {
        let mut errs = Vec::new();
        if !(1..=2).contains(&e.cuts.len()) {
            errs.push("ต้องมี 1-2 cuts".to_string());
        }
        for c in &e.cuts {
            check_cut(c, "cut", &source, &mut errs);
            if matches!(c.shot.as_str(), "product" | "product-open" | "price") && twist.is_none_or(|t| scene - 1 <= t) {
                errs.push("ฉากนี้อยู่ก่อนแถวหักมุม ยังโชว์สินค้าไม่ได้".to_string());
            }
        }
        errs
    })
    .await?;
    replace_scene(&mut script, scene, edit.cuts)?;
    save_script(dir, &script)?;
    stage_renderer(app, job, dir, &script)?;
    render_scenes(app, dir, &[scene]).await?;
    job.seconds = build_draft(app, dir, &script).await?;
    job.warnings.retain(|w| !w.starts_with("แก้ฉาก"));
    if !edit.note.trim().is_empty() {
        job.warnings.push(format!("แก้ฉากที่ {scene}: {}", edit.note.trim()));
    }
    job.state = "review".into();
    job.stage = "รอตรวจ".into();
    Ok(())
}

async fn export(app: &App, job: &mut Job, dir: &Path) -> Result<()> {
    job.stage = "กำลังส่งออก".into();
    app.save_job(job)?;
    let script = load_script(dir)?;
    let jdir = app.job_dir(&job.id);
    let product: Product = serde_json::from_str(&std::fs::read_to_string(jdir.join("product.json"))?)?;
    let export = app.root.join(&app.cfg.read().await.export_dir);
    std::fs::create_dir_all(&export)?;
    let caption = format!("{}\n\n{}\n\n{}\n", script.caption.trim(), script.hashtags.join(" "), product.url);
    std::fs::copy(dir.join("draft.mp4"), jdir.join("out.mp4"))?;
    std::fs::write(jdir.join("caption.txt"), &caption)?;
    std::fs::copy(dir.join("draft.mp4"), export.join(format!("{}.mp4", job.id)))?;
    std::fs::write(export.join(format!("{}.txt", job.id)), caption)?;
    job.state = "done".into();
    job.stage = "ส่งออกแล้ว".into();
    Ok(())
}

/* ─── HTTP ─── */

/// Makes a story job for a product whose page data is already here, and queues it.
pub fn create_from(app: &App, base_id: &str) -> Result<String> {
    let base = app.load_job(base_id)?;
    let from = app.job_dir(base_id);
    need(from.join("product.json").is_file() && pipeline::has_verified_gallery(&from), "ยังไม่มีข้อมูลสินค้า เปิดหน้าสินค้าแล้วกดไอคอนส่วนขยายก่อน")?;
    let id = format!("story-{base_id}");
    if let Ok(existing) = app.load_job(&id) {
        need(!matches!(existing.state.as_str(), "queued" | "running"), "สินค้านี้มีงานเล่าเรื่องกำลังทำอยู่")?;
        // a fresh story: the old one goes, the product data stays
        let _ = std::fs::remove_dir_all(sdir(app, &id));
    }
    let dir = app.job_dir(&id);
    std::fs::create_dir_all(&dir)?;
    std::fs::copy(from.join("product.json"), dir.join("product.json"))?;
    // url fields stay empty on purpose: a story job must never be mistaken for the product's clip job
    let job = Job { id: id.clone(), kind: KIND.into(), title: base.title.clone(), state: "queued".into(), stage: "รอคิว".into(), seed: crate::new_seed(), created: crate::now(), ..Default::default() };
    app.save_job(&job)?;
    app.queue.send(id.clone())?;
    Ok(id)
}

pub async fn page() -> Html<&'static str> {
    Html(include_str!("../ui/story.html"))
}
pub async fn page_script() -> ([(header::HeaderName, &'static str); 1], &'static str) {
    ([(header::CONTENT_TYPE, "text/javascript; charset=utf-8")], include_str!("../ui/story.js"))
}

#[derive(Deserialize)]
pub struct LinkReq {
    url: String,
}
/// Paste a link on the Story page: start now if the product is known, else open the tab and start when the extension reports.
pub async fn add_link(State(app): State<Shared>, Json(req): Json<LinkReq>) -> Api<Json<Value>> {
    let url = crate::shopee_url(&req.url).context("ไม่ใช่ลิงก์สินค้า Shopee")?;
    let item = crate::item_id(&url).context("ใช้ลิงก์เต็มของหน้าสินค้า (ลิงก์ย่อยังไม่รองรับในหน้านี้)")?;
    let known = {
        let _mutation = app.begin_job_mutation()?;
        app.jobs().into_iter().find(|j| j.kind != KIND && crate::same_product(j, &url) && pipeline::has_verified_gallery(&app.job_dir(&j.id)))
    };
    if let Some(base) = known {
        let _mutation = app.begin_job_mutation()?;
        return Ok(Json(json!({"job": create_from(&app, &base.id)?, "started": true})));
    }
    // unknown product: reuse the normal link flow, and leave a note so ingest starts the story
    let _ = crate::add_links(State(app.clone()), Json(crate::LinksReq { urls: vec![url.to_string()], style: String::new() })).await?;
    let dir = app.job_dir(&item);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("want-story"), "")?;
    Ok(Json(json!({"job": format!("story-{item}"), "started": false})))
}

/// Called by ingest: if this product was asked for from the Story page, start its story now.
pub fn on_ingest(app: &App, base_id: &str) {
    let marker = app.job_dir(base_id).join("want-story");
    if marker.is_file() && create_from(app, base_id).is_ok() {
        let _ = std::fs::remove_file(marker);
    }
}

pub async fn list(State(app): State<Shared>) -> Json<Vec<Job>> {
    Json(app.jobs().into_iter().filter(|j| j.kind == KIND).collect())
}

fn story_job(app: &App, id: &str) -> Result<Job> {
    let job = app.load_job(crate::checked_job_id(id)?)?;
    need(job.kind == KIND, "ไม่ใช่งานเล่าเรื่อง")?;
    Ok(job)
}

pub async fn detail(State(app): State<Shared>, UrlPath(id): UrlPath<String>) -> Api<Json<Value>> {
    let job = story_job(&app, &id)?;
    let dir = sdir(&app, &id);
    let script = load_script(&dir).ok();
    let scenes: Vec<Value> = std::fs::read_to_string(dir.join("scenes.json")).ok().and_then(|r| serde_json::from_str(&r).ok()).unwrap_or_default();
    Ok(Json(json!({"job": job, "script": script, "scenes": scenes})))
}

fn queue_todo(app: &App, id: &str, todo: &Todo) -> Result<()> {
    let _mutation = app.begin_job_mutation()?;
    let mut job = story_job(app, id)?;
    need(job.state == "review", "งานนี้ยังไม่อยู่ในขั้นรอตรวจ")?;
    std::fs::write(sdir(app, id).join("todo.json"), serde_json::to_string(todo)?)?;
    job.state = "queued".into();
    job.stage = "รอคิว".into();
    app.save_job(&job)?;
    app.queue.send(id.to_string())?;
    Ok(())
}

#[derive(Deserialize)]
pub struct EditReq {
    instruction: String,
}
pub async fn edit(State(app): State<Shared>, UrlPath((id, scene)): UrlPath<(String, usize)>, Json(req): Json<EditReq>) -> Api<Json<Value>> {
    let instruction = req.instruction.trim();
    need(!instruction.is_empty() && instruction.chars().count() <= 400, "พิมพ์สิ่งที่อยากแก้ ไม่เกิน 400 ตัวอักษร")?;
    queue_todo(&app, &id, &Todo::Edit { scene, instruction: instruction.to_string() })?;
    Ok(Json(json!({"ok": true})))
}

pub async fn confirm(State(app): State<Shared>, UrlPath(id): UrlPath<String>) -> Api<Json<Value>> {
    queue_todo(&app, &id, &Todo::Export)?;
    Ok(Json(json!({"ok": true})))
}

/// Start over after a failure, or write a new story for the same product.
pub async fn restart(State(app): State<Shared>, UrlPath(id): UrlPath<String>) -> Api<Json<Value>> {
    let _mutation = app.begin_job_mutation()?;
    let job = story_job(&app, &id)?;
    need(!matches!(job.state.as_str(), "queued" | "running"), "งานนี้อยู่ในคิวหรือกำลังทำอยู่")?;
    let base = id.strip_prefix("story-").unwrap_or(&id);
    Ok(Json(json!({"job": create_from(&app, base)?})))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cut(shot: &str) -> Cut {
        Cut { shot: shot.into(), ..Default::default() }
    }
    fn row(vo: &str, shot: &str) -> Row {
        Row { vo: vo.into(), sub: "x".into(), cuts: vec![cut(shot)] }
    }
    fn good() -> Script {
        let mut rows = vec![row("ถ้าลูกร้องหิว ตอนตีสอง อย่าเพิ่งตักนมผง", "subject")];
        rows.extend((0..7).map(|_| row("คุณล้างมือ เช็ดให้แห้ง", "wide")));
        rows.push(row("คุณทำถูกทุกอย่าง ยกเว้นเรื่องเดียว", "face"));
        rows.push(row("ฝาปิดไม่สนิท", "subject-close"));
        rows.push(row("กระปุกนี้ฝาซีลกันชื้น", "product"));
        let mut price = row("หนึ่งร้อยเจ็ดสิบเก้าบาท", "price");
        price.cuts[0].card = Some(json!({"type": "price", "amount": "179"}));
        rows.push(price);
        Script { title: "t".into(), rule: "อย่าเพิ่งตัก".into(), rule_label: "ลูกร้องหิวตอนตีสอง".into(), rows, ..Default::default() }
    }
    const SRC: &str = "กระปุกเก็บนมผง ฿179 ฝาซีลกันชื้น";

    #[test]
    fn accepts_a_valid_story() {
        assert_eq!(validate(&good(), SRC, &[]), Vec::<String>::new());
    }

    #[test]
    fn rejects_a_story_without_the_formula() {
        let mut s = good();
        s.rows[0].vo = "วันนี้มาแนะนำกระปุกนมผง".into();
        s.rows[8].vo = "แล้วก็พบปัญหา".into();
        let errs = validate(&s, SRC, &[]).join("\n");
        assert!(errs.contains("ถ้า... อย่า..."), "{errs}");
        assert!(errs.contains(TWIST), "{errs}");
        assert!(errs.contains("สินค้าต้องเข้าหลังแถวหักมุม"), "{errs}"); // no twist row = product is never allowed
    }

    #[test]
    fn rejects_things_outside_the_library_and_invented_prices() {
        let mut s = good();
        s.rows[2].cuts[0].shot = "drone".into();
        s.rows[3].cuts[0].state = Some(serde_json::from_value(json!({"fire": true})).unwrap());
        s.rows[4].vo = "เปิดมาแล้ว 19 วัน".into();
        s.rows[5].vo = "ข้างสระบัว".into();
        s.rows[11].cuts[0].card = Some(json!({"type": "price", "amount": "99"}));
        s.rows[1].cuts[0].shot = "product".into(); // before the twist
        let errs = validate(&s, SRC, &[]).join("\n");
        for want in ["drone", "fire", "เขียนเป็นคำไทย", "บัว", "ราคา \"99\"", "หลังแถวหักมุม"] {
            assert!(errs.contains(want), "missing {want}: {errs}");
        }
    }

    #[test]
    fn editing_one_scene_leaves_the_others_untouched() {
        let mut s = good();
        let before = serde_json::to_value(&s).unwrap();
        replace_scene(&mut s, 3, vec![cut("pet")]).unwrap();
        let after = serde_json::to_value(&s).unwrap();
        for i in 0..s.rows.len() {
            assert_eq!(before["rows"][i] == after["rows"][i], i != 2, "row {i}");
        }
        assert!(replace_scene(&mut s, 99, vec![]).is_err());
        assert!(replace_scene(&mut s, 0, vec![]).is_err());
    }

    #[test]
    fn script_md_has_the_narration_block_and_table() {
        let md = script_md(&good());
        assert!(md.contains("| 1 | ถ้าลูกร้องหิว ตอนตีสอง อย่าเพิ่งตักนมผง | x |"));
        assert!(md.contains("```\nถ้าลูกร้องหิวตอนตีสองอย่าเพิ่งตักนมผง "));
    }
}
