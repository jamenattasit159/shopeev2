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
/// Ways to tell the story (design doc 4.1): (id, how the middle goes, what the turn row is).
/// Each job gets one the latest clips have not used, so the channel does not tell the same story twice in a row.
pub const ANGLES: [(&str, &str, &str); 6] = [
    ("twist", "คุณทำตามขั้นตอนทีละขั้น ทุกอย่างดูถูกต้อง แต่ผลออกมาผิด เพราะรายละเอียดทางกายภาพหนึ่งอย่างที่อยู่ในภาพตั้งแต่ต้น (ตั้งด้วย state ตั้งแต่แถวแรกๆ)",
        "แถว \"คุณทำถูกทุกอย่าง ยกเว้นเรื่องเดียว\" ตามด้วยแถวเฉลยที่ใช้ shot subject-close"),
    ("myth", "คนส่วนใหญ่เชื่อวิธีหนึ่งที่ฟังดูถูก คุณก็ทำตามความเชื่อนั้น ผลค่อยๆ แย่ลง",
        "แถวที่หักล้างความเชื่อนั้นด้วยข้อเท็จจริงหนึ่งข้อ (ขึ้นต้นประมาณว่า \"แต่ความจริงคือ\")"),
    ("countdown", "เหตุการณ์มีเส้นตายชัดเจน เวลาบนจอ (card clock) เดินเร็วขึ้นทุกแถว ทุกแถวกดดันกว่าแถวก่อน",
        "แถวที่เวลาหมดหรือเกือบหมด แล้วคุณเห็นว่าวิธีที่ใช้อยู่ไม่ทัน"),
    ("signs", "สัญญาณเตือนเล็กๆ สามอย่างโผล่ทีละข้อ คุณมองข้ามสองข้อแรกเพราะดูไม่สำคัญ (ใช้ state ของฉากแสดงสัญญาณแต่ละข้อ)",
        "แถวที่สัญญาณข้อที่สามโผล่ และคุณรู้ว่าสองข้อแรกคือเรื่องเดียวกัน"),
    ("two-ways", "เล่าสถานการณ์เดียวกันสองแบบ แบบแรกทำตามสัญชาตญาณแล้วพัง",
        "แถวที่ย้อนกลับไปจุดเริ่ม แล้วเล่าแบบที่สองที่ทำตามกฎ"),
    ("pet-knew", "แมวรู้ตั้งแต่แรกว่ามีอะไรผิด ใช้ shot pet และ pet-subject เล่าตามสายตาแมว แต่คุณไม่เห็น",
        "แถวที่คุณหันไปเห็นสิ่งที่แมวจ้องมาตลอด"),
];
fn angle_of(id: &str) -> &'static (&'static str, &'static str, &'static str) {
    ANGLES.iter().find(|a| a.0 == id).unwrap_or(&ANGLES[0])
}

/// The row (0-based) where the story turns; the product may only appear after it.
/// Scripts written before angles existed are "twist" stories.
pub fn turn_index(s: &Script) -> Option<usize> {
    if s.angle.is_empty() || s.angle == "twist" {
        return s.rows.iter().position(|r| r.vo.contains(TWIST));
    }
    (s.turn_row >= 1 && s.turn_row <= s.rows.len()).then(|| s.turn_row - 1)
}
const SHOTS: [&str; 12] = ["subject", "subject-close", "top", "face", "wide", "pet", "pet-subject", "aux", "product", "product-open", "photo", "price"];
const YOU_POSES: [&str; 7] = ["rest", "sleepy", "look", "reach", "dig", "shock", "relief"];
const PET_POSES: [&str; 3] = ["stare", "calm", "sleep"];
const CARDS: [&str; 6] = ["rule", "tag", "clock", "proof", "photo", "price"];
/// A room from the library (story/src/sets). `state` = (key, what it shows): the AI may only use these keys.
pub struct SetDef {
    pub name: &'static str,
    /// what products it suits, for choosing
    suits: &'static str,
    /// what is in the room, for writing the story
    room: &'static str,
    subject: &'static str,
    aux: &'static str,
    state: &'static [(&'static str, &'static str)],
}
/// state every set understands
const COMMON_STATE: [(&str, &str); 3] = [
    ("cold", "0..1 = แสงเย็นแบบแสงจันทร์ ใช้ตอนหักมุม"),
    ("product", "true = สินค้าวางอยู่แทนของสำคัญ (ใช้กับ shot wide/face หลังเปิดตัวสินค้า)"),
    ("twist", "true = วางของประกอบจุดหักมุมที่สร้างเฉพาะคลิปนี้ (ดู twistProp) ไว้ตรงตำแหน่งของ aux"),
];
pub const SETS: [SetDef; 3] = [
    SetDef {
        name: "kitchen",
        suits: "ของใช้ในครัว ของเด็ก อาหาร เครื่องดื่ม ภาชนะ",
        room: "ครัวตอนกลางคืน \"คุณ\" ยืนหลังเคาน์เตอร์หันหน้าเข้ากล้อง บนเคาน์เตอร์มีภาชนะทรงกระป๋องมีฝาหนึ่งใบ วางเขียงได้ และแมวนั่งข้างๆ",
        subject: "ภาชนะทรงกระป๋องมีฝาบนเคาน์เตอร์ ข้างในเป็นผงหรือของแห้ง ฉลากและสติกเกอร์เขียนเองได้ด้วย subjectLabel และ subjectNote (เช่น น้ำตาล กาแฟ ข้าวสาร เครื่องปรุง อาหารแมว ผงซักฟอก)",
        aux: "แก้วน้ำบนเคาน์เตอร์ (ต้อง state cup เป็น true)",
        state: &[
            ("lid", "ฝากระป๋อง: \"ajar\" (เผยอ ค่าเริ่มต้น), \"on\" (ปิดสนิท), \"off\" (เปิดออกวางข้างๆ)"),
            ("scoop", "true = มีช้อนจมอยู่ในผง (เห็นเมื่อ lid เป็น off)"),
            ("clump", "0..1 = ผงจับเป็นก้อน (เห็นเมื่อ lid เป็น off)"),
            ("cup", "true = มีแก้วน้ำบนเคาน์เตอร์"),
            ("lumps", "true = มีก้อนผงลอยในแก้ว"),
            ("stain", "0..1 = คราบเลอะบนเคาน์เตอร์รอบของสำคัญ"),
            ("board", "true = มีเขียงกับมีดบนเคาน์เตอร์"),
            ("raw", "true = มีชิ้นเนื้อดิบบนเขียง (ต้อง board เป็น true)"),
        ],
    },
    SetDef {
        name: "bedroom",
        suits: "เครื่องนอน ของใช้เด็กตอนนอน ของช่วยนอน โคมไฟ ของใช้ข้างเตียง",
        room: "ห้องนอนตอนกลางคืน \"คุณ\" ยืนหลังตู้ลิ้นชักหันหน้าเข้ากล้อง บนตู้มีโคมไฟหัวเตียงกับปลั๊กพ่วงและแมวนั่งข้างๆ ด้านหลังเป็นเตียงกับหน้าต่างมีม่าน",
        subject: "โคมไฟหัวเตียงกับปลั๊กของมัน",
        aux: "โทรศัพท์บนตู้ (ต้อง state phone เป็น true)",
        state: &[
            ("lamp", "โคมไฟ: \"on\" (ค่าเริ่มต้น), \"dim\" (หรี่), \"off\""),
            ("cord", "ปลั๊กโคมไฟ: \"in\" (ค่าเริ่มต้น), \"loose\" (เสียบไม่สุด เห็นขาปลั๊ก)"),
            ("blanket", "ผ้าห่มบนเตียง: \"neat\" (ค่าเริ่มต้น), \"messy\" (กองยับ), \"floor\" (ตกพื้น)"),
            ("curtain", "ม่าน: \"closed\" (ค่าเริ่มต้น), \"gap\" (แง้ม มีแสงลอดลงบนเตียง)"),
            ("cot", "true = มีเตียงเด็กข้างเตียง"),
            ("phone", "true = มีโทรศัพท์บนตู้"),
            ("lit", "true = จอโทรศัพท์สว่าง"),
        ],
    },
    SetDef {
        name: "bathroom",
        suits: "ของใช้ส่วนตัว สบู่ แชมพู ของทำความสะอาด ของใช้ในห้องน้ำ",
        room: "ห้องน้ำตอนดึก \"คุณ\" ยืนหลังเคาน์เตอร์อ่างล้างหน้าหันหน้าเข้ากล้อง บนเคาน์เตอร์มีขวดปั๊มหนึ่งขวดและแมวนั่งข้างๆ ด้านหลังเป็นกระจก ผนังกระเบื้อง ราวผ้าเช็ดตัว",
        subject: "ขวดปั๊มบนเคาน์เตอร์",
        aux: "แก้วแปรงสีฟันบนเคาน์เตอร์ (ต้อง state cup เป็น true)",
        state: &[
            ("cap", "หัวปั๊มของขวด: \"on\" (ค่าเริ่มต้น), \"open\" (คลายเกลียว เอียง), \"off\" (ถอดวางข้างๆ)"),
            ("leak", "true = มีของเหลวรั่วเป็นแอ่งใต้ขวด"),
            ("mold", "0..1 = คราบราดำบนกระเบื้องและรอบฐานขวด"),
            ("mirror", "กระจก: \"clear\" (ค่าเริ่มต้น), \"fog\" (ฝ้า)"),
            ("tap", "ก๊อกน้ำ: \"off\" (ค่าเริ่มต้น), \"drip\" (หยด)"),
            ("towel", "ผ้าเช็ดตัว: \"hung\" (ค่าเริ่มต้น), \"floor\" (ตกพื้น)"),
            ("cup", "true = มีแก้วแปรงสีฟัน"),
            ("slime", "true = มีคราบเมือกในแก้วแปรงสีฟัน"),
        ],
    },
];
/// The set a script plays in. Scripts written before sets existed have no name: they are kitchen stories.
pub fn set_of(name: &str) -> Option<&'static SetDef> {
    SETS.iter().find(|s| s.name == name || (name.is_empty() && s.name == "kitchen"))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Cut {
    pub shot: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub you: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pet: Option<String>,
    #[serde(rename = "noPet", skip_serializing_if = "Option::is_none")]
    pub no_pet: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<serde_json::Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
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

/// Picture styles. The plan (film.json) is the same for all of them; only the renderer changes, so a draft can switch style
/// without a new script or voice. (id, what it looks like, what it suits) — the AI recommends one, the owner may pick another.
pub const STYLES: [(&str, &str, &str); 3] = [
    ("3d", "แอนิเมชัน 3 มิติ ตัวละครดินปั้น แสงอุ่นแบบโมเดลจำลอง", "ของใช้ทั่วไป สินค้าที่อยากให้ดูจริงจังน่าเชื่อถือ"),
    ("crayon", "สมุดภาพเด็กวาดด้วยสีเทียนบนกระดาษ เส้นสั่นแบบวาดมือ สีน้ำระบายตอนกลางคืน", "ของเด็ก แม่และเด็ก ของใช้ในบ้านที่อบอุ่น เรื่องซึ้ง"),
    ("toon", "การ์ตูนขาวดำยุค 1930 ตาชิ้นพาย ถุงมือขาว ของทุกชิ้นมีหน้าและเต้นตามจังหวะ ฟิล์มเก่า สินค้าจริงเป็นภาพสีชิ้นเดียว", "ของใช้ในบ้าน ทำความสะอาด เครื่องครัว เรื่องตลก สินค้าที่อยากให้เด่นสะดุดตา"),
];
pub fn style_ok(id: &str) -> bool {
    id.is_empty() || STYLES.iter().any(|s| s.0 == id)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Script {
    /// picture style (STYLES); empty = "3d"
    pub style: String,
    /// why the AI picked that style for this product (shown on the review page)
    #[serde(rename = "styleWhy")]
    pub style_why: String,
    /// the AI's own pick, kept when the owner switches style
    pub recommended: String,
    /// how the story is told (ANGLES)
    pub angle: String,
    /// 1-based row where the story turns (see ANGLES); for "twist" it is the "ยกเว้นเรื่องเดียว" row
    #[serde(rename = "turnRow")]
    pub turn_row: usize,
    /// the room from the library: kitchen | bedroom | bathroom
    pub set: String,
    /// why this set, when none really fits the story (shown as a warning on the review page)
    #[serde(rename = "setNote")]
    pub set_note: String,
    /// the per-clip twist prop Claude should model (empty = none)
    #[serde(rename = "twistProp")]
    pub twist_prop: String,
    /// words on the story's object (the kitchen container's label), and a short sticker under it
    /// what the product is and the problem it solves, in the AI's words (checked against the story)
    #[serde(rename = "productUse")]
    pub product_use: String,
    #[serde(rename = "subjectLabel")]
    pub subject_label: String,
    #[serde(rename = "subjectNote")]
    pub subject_note: String,
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

fn check_cut(c: &Cut, set: &SetDef, at: &str, source_digits: &str, errs: &mut Vec<String>) {
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
        if !set.state.iter().chain(&COMMON_STATE).any(|(k, _)| k == key) {
            errs.push(format!("{at}: ฉาก {} ไม่มี state \"{key}\"", set.name));
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
    let Some(set) = set_of(&s.set) else {
        return vec![format!("ไม่มีฉาก \"{}\" ในคลัง เลือกจาก kitchen, bedroom, bathroom", s.set)];
    };
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
    if !style_ok(&s.style) {
        errs.push(format!("ไม่มีรูปแบบภาพ \"{}\"", s.style));
    }
    if !s.angle.is_empty() && !ANGLES.iter().any(|a| a.0 == s.angle) {
        errs.push(format!("ไม่มีมุมเล่า \"{}\"", s.angle));
    }
    if s.rows.iter().filter(|r| r.vo.contains("คุณทำถูก")).count() > 1 {
        errs.push("ประโยค \"คุณทำถูก...\" ใช้ได้แถวเดียว".into());
    }
    let twist = turn_index(s);
    match twist {
        None if s.angle.is_empty() || s.angle == "twist" => errs.push(format!("ต้องมีแถว \"คุณทำถูกทุกอย่าง {TWIST}\" เป็นแถวของตัวเอง")),
        None => errs.push("turnRow ต้องเป็นเลขแถวจุดเปลี่ยนของเรื่อง".into()),
        Some(t) if t < 2 || t + 3 > n => errs.push("แถวจุดเปลี่ยนต้องอยู่หลังแถว 3 และเหลืออย่างน้อย 2 แถวให้สินค้าหลังจากนั้น".into()),
        Some(_) => {}
    }
    if s.subject_label.chars().count() > 10 || s.subject_note.chars().count() > 18 {
        errs.push("subjectLabel ต้องไม่เกิน 10 ตัวอักษร และ subjectNote ไม่เกิน 18".into());
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
            check_cut(c, set, &at, &source_digits, &mut errs);
            let shows_product = matches!(c.shot.as_str(), "product" | "product-open" | "price")
                || c.state.as_ref().is_some_and(|m| m.get("product").is_some_and(|v| v == &json!(true)));
            if shows_product && twist.is_none_or(|t| i <= t) {
                errs.push(format!("{at}: สินค้าต้องเข้าหลังแถวจุดเปลี่ยนเท่านั้น"));
            }
        }
    }
    errs
}

fn set_doc(set: &SetDef) -> String {
    let states: Vec<String> = set.state.iter().map(|(k, d)| format!("    - {k}: {d}")).collect();
    format!("- \"{}\" เหมาะกับ: {}\n  ในฉาก: {}\n  ของสำคัญ (subject): {}\n  aux: {}\n  state ของฉากนี้:\n{}", set.name, set.suits, set.room, set.subject, set.aux, states.join("\n"))
}

/// What the AI may use. `only` = the script's own set (for an edit); None = every set (for a new story).
fn library_doc(only: Option<&SetDef>) -> String {
    let sets: Vec<String> = SETS.iter().filter(|s| only.is_none_or(|o| o.name == s.name)).map(set_doc).collect();
    let common: Vec<String> = COMMON_STATE.iter().map(|(k, d)| format!("  - {k}: {d}")).collect();
    format!(
        r##"คลังที่ใช้ได้ (ห้ามใช้ค่านอกเหนือจากนี้):
ฉาก (set):
{sets}
state ที่ใช้ได้ทุกฉาก:
{common}
(state ใส่ใน "state" ของ cut ต้องใส่ซ้ำทุก cut ที่อยากให้เห็น ไม่จำค่าข้าม cut)
shot:
  - subject: ของสำคัญของฉาก ระยะกลาง
  - subject-close: โคลสอัพที่ของสำคัญ (ใช้เฉลยจุดหักมุม)
  - top: มองลงมาที่ของสำคัญจากด้านบน
  - face: หน้าของคุณ
  - wide: ทั้งห้อง เห็นคุณ แมว และของบนเคาน์เตอร์
  - pet: แมว
  - pet-subject: แมวกับของสำคัญในเฟรมเดียว
  - aux: ของชิ้นที่สองบนเคาน์เตอร์ (ดู aux ของฉาก) หรือของประกอบจุดหักมุมเมื่อ state twist เป็น true
  - product: สินค้าวางแทนของสำคัญ
  - product-open: สินค้ากำลังเปิดฝา
  - photo: รูปสินค้าจริงจากร้าน ต้องมี card แบบ photo
  - price: รูปสินค้าจริงพร้อมป้ายราคา ต้องมี card แบบ price
ท่า you: {you}
ท่า pet: {pet}
card:
  - {{"type":"rule"}} ป้ายกฎ ใช้ใน cut แรกของแถว 1
  - {{"type":"tag"}} ป้ายกฎเล็ก
  - {{"type":"clock","t":"<ชั่วโมง:นาที>","label":"<สถานที่>"}} นาฬิกามุมจอ เวลาต้องตรงกับเรื่อง
  - {{"type":"proof","title":"...","big":"4","unit":"สัปดาห์","note":"...","source":"ที่มา"}} การ์ดข้อเท็จจริง มีตัวเลขใหญ่หนึ่งตัว
  - {{"type":"photo","src":"product.png","label":"คำบรรยายสั้น"}} src เป็น product.png หรือ img1.png ถึง img5.png
  - {{"type":"price","amount":"<ราคา>"}} ตัวเลขราคาจากข้อมูลสินค้าเท่านั้น ใช้ได้เฉพาะเมื่อข้อมูลมีราคา"##,
        sets = sets.join("\n"),
        common = common.join("\n"),
        you = YOU_POSES.join(", "),
        pet = PET_POSES.join(", "),
    )
}

/// The page's price, if the extension caught one ("฿179", "฿1,290").
fn has_price(source: &str) -> bool {
    source.split('฿').skip(1).any(|rest| rest.trim_start().starts_with(|c: char| c.is_ascii_digit()))
}

fn script_prompt(title: &str, source: &str, images: usize, angle: &str, recent: &[String]) -> String {
    let (angle_id, angle_middle, angle_turn) = *angle_of(angle);
    let recent = if recent.is_empty() { "- (ยังไม่มี)".to_string() } else { recent.iter().map(|r| format!("- {r}")).collect::<Vec<_>>().join("\n") };
    let price_rule = if has_price(source) {
        "บอกราคา (ตัวเลขตรงกับราคาในข้อมูลสินค้า) และ \"พิกัดอยู่ในตะกร้า\""
    } else {
        "ปิดด้วย \"พิกัดอยู่ในตะกร้า\" ข้อมูลสินค้านี้ไม่มีราคา ห้ามพูดหรือแต่งราคา ห้ามใช้ shot price และ card price"
    };
    format!(
        r##"คุณเป็นคนเขียนบทและผู้กำกับคลิปโฆษณาสั้นแนว "กฎเอาตัวรอด" ความยาวไม่เกิน 55 วินาที เป็นแอนิเมชัน 3 มิติ
เล่าด้วยบุรุษที่สอง ("คุณ") ปัจจุบันกาล ประโยคสั้น เสียงนิ่ง ไม่ขายของจนกว่าจะถึงท้ายเรื่อง

หัวใจของเรื่อง: ปัญหาในเรื่องต้องเป็นปัญหาที่ตัวสินค้านี้แก้ได้โดยตรง ตามวิธีใช้จริงของมัน (ดูจากชื่อและข้อมูลสินค้า) คนดูต้องดูจบแล้วรู้ว่าสินค้าคืออะไรและใช้ทำอะไร
ห้ามแต่งเรื่องที่ปัญหาหลักเป็นของสินค้าประเภทอื่น แล้วให้สินค้านี้เป็นแค่ตัวช่วยข้างๆ (เช่น สินค้าเป็นสเปรย์ทำความสะอาด ปัญหาต้องเป็นสิ่งที่ต้องฉีดทำความสะอาด) ของสำคัญ (subject) และจุดหักมุมต้องเป็นสิ่งที่สินค้านี้แก้ได้ตรงๆ
ก่อนแต่ง ให้ตอบตัวเองว่า: สินค้านี้คืออะไร คนซื้อไปใช้ทำอะไร ปัญหาที่มันแก้คืออะไร แล้วเขียนคำตอบไว้ใน "productUse"

ขั้นแรก: เลือกฉาก (set) จากคลังที่เข้ากับสินค้าที่สุดก่อนแต่งเรื่อง แล้วแต่งเรื่องให้เกิดในฉากนั้นและใช้ของในฉากนั้นจริง
ถ้าไม่มีฉากไหนเข้ากับสินค้าเลย ให้เลือกฉากที่ใกล้สุด และเขียนเหตุผลสั้นๆ ไว้ใน "setNote" (ถ้าเข้ากันดีให้ setNote เป็นค่าว่าง)

โครงเรื่อง (บังคับ) มุมเล่าของคลิปนี้: "{angle_id}"
1. แถว 1 คือกฎ "ถ้า<สถานการณ์ที่มีตัวเลขหรือเวลา> อย่า<สิ่งที่คนทำตามสัญชาตญาณ>" ต้องเป็นเรื่องที่คนใช้สินค้านี้เจอจริง
2. สถานการณ์ เวลา และตัวคุณ เลือกให้เข้ากับคนที่ใช้สินค้านี้จริงและช่วงเวลาที่ใช้จริง ไม่จำเป็นต้องเป็นกลางดึก (ฉากเป็นตอนค่ำ ใช้ได้ตั้งแต่หัวค่ำถึงก่อนรุ่งสาง)
3. ข้อเท็จจริงหนึ่งข้อที่มีตัวเลข ช่วยยกเดิมพัน
4. แมว (ตั้งชื่อไทยสั้นๆ ไม่ซ้ำกับเรื่องก่อนๆ) มีบทบาทในเรื่อง
5. กลางเรื่อง: {angle_middle}
6. จุดเปลี่ยน: {angle_turn} ใส่เลขแถวนี้ใน "turnRow" สิ่งที่เฉลยต้องเป็นสาเหตุที่สินค้านี้กำจัดได้ตรงๆ ใช้สินค้าแล้วสาเหตุนั้นต้องหายไป ห้ามเฉลยเป็นของอื่นที่สินค้าไม่เกี่ยว
7. สินค้าเข้ามาเป็นคำตอบของปัญหานั้น 2-3 แถวหลังจุดเปลี่ยน พูดเฉพาะคุณสมบัติที่มีในข้อมูลสินค้า แล้ว{price_rule}
8. แถวสุดท้ายเป็นประโยคปิดสั้นๆ ที่วนกลับไปที่สถานการณ์ตอนต้น

ห้ามซ้ำกับเรื่องที่ช่องเคยทำ: ห้ามใช้สถานการณ์ เวลา กฎ ชื่อแมว และประโยคเปิดที่คล้ายกับเรื่องเหล่านี้
{recent}

กฎการเขียน:
- 12-16 แถว แถวละหนึ่งประโยค vo รวมทุกแถวไม่เกิน 600 ตัวอักษร
- vo: คั่นวลีด้วยเว้นวรรค วลีละไม่เกิน 7 คำ ตัวเลขเขียนเป็นคำไทย (สิบเก้า ไม่ใช่ 19) ชื่อยี่ห้อภาษาอังกฤษเขียนเป็นคำอ่านไทย
- sub: คำแปลภาษาอังกฤษเต็มประโยค ใช้ตัวเลขได้
- ห้ามอ้างสรรพคุณทางการแพทย์ ห้ามคำว่า การันตี ดีที่สุด อันดับหนึ่ง และห้ามมีคำว่า "บัว"
- ข้อเท็จจริงที่มีตัวเลขและไม่ได้มาจากข้อมูลสินค้า ให้ใส่ไว้ใน "unverified" ทุกข้อ เพื่อให้เจ้าของตรวจ
- สินค้า (shot product, product-open, price หรือ state product) ใช้ได้เฉพาะแถวหลังแถวจุดเปลี่ยน
- แต่ละแถวมี 1-2 cuts สลับระยะกล้อง อย่าใช้ shot เดิมติดกันเกินสองครั้ง
- จุดหักมุมต้องเล่าได้ด้วย state ในคลังของฉากที่เลือกเสมอ ถ้าอยากได้ของประกอบเฉพาะเรื่องเพิ่ม (หนึ่งชิ้น เล็ก วางบนเคาน์เตอร์ได้) ให้บรรยายรูปร่างไว้ใน "twistProp" แล้วใช้ state twist กับ shot aux แต่เรื่องต้องเข้าใจได้แม้ไม่มีของชิ้นนี้

{library}

มีรูปสินค้าจริง {images} รูป: product.png (รูปหลัก) และ img1.png เป็นต้นไป

รูปแบบภาพ: เลือกหนึ่งแบบที่เข้ากับสินค้าและคนซื้อที่สุด ใส่ใน "style" และเหตุผลสั้นๆ ใน "styleWhy"
{styles}

ตอบเป็น JSON อย่างเดียว:
{{
  "style": "3d หรือ crayon หรือ toon",
  "styleWhy": "เหตุผลหนึ่งประโยค",
  "angle": "{angle_id}",
  "turnRow": 0,
  "set": "kitchen หรือ bedroom หรือ bathroom",
  "setNote": "",
  "twistProp": "รูปร่างของของประกอบจุดหักมุม หรือค่าว่างถ้าไม่ใช้",
  "productUse": "สินค้านี้คืออะไร ใช้ทำอะไร แก้ปัญหาอะไร หนึ่งประโยค",
  "subjectLabel": "คำบนฉลากของสำคัญ ไม่เกิน 10 ตัวอักษร (ฉากครัวเท่านั้น ฉากอื่นเว้นว่าง)",
  "subjectNote": "สติกเกอร์สั้นใต้ฉลากที่เป็นเบาะแสจุดหักมุม ไม่เกิน 18 ตัวอักษร หรือค่าว่าง",
  "title": "ชื่อเรื่องสั้นๆ",
  "rule": "ส่วน 'อย่า...' ไม่เกิน 4 คำ",
  "ruleLabel": "ส่วน 'ถ้า...' ไม่เกิน 6 คำ ไม่ต้องมีคำว่าถ้า",
  "red": ["วลีจาก vo ที่ต้องเน้นสีแดง 4-6 วลี ต้องตรงกับวลีใน vo ทุกตัวอักษร"],
  "amb": ["วลีจาก vo ที่เป็นเวลา ตัวเลข ชื่อ 6-10 วลี ตรงทุกตัวอักษร"],
  "brand": "ชื่อยี่ห้อตัวอักษรอังกฤษ ไม่เกิน 12 ตัว",
  "endLine": "ชนิดสินค้า + พิกัดอยู่ในตะกร้า",
  "rows": [{{"vo": "...", "sub": "...", "cuts": [{{"shot": "subject", "you": "rest", "pet": "stare", "state": {{}}, "card": {{"type": "rule"}}}}]}}],
  "explain": "อธิบายเรื่อง: เกี่ยวกับอะไร ทำไมมีกฎนี้ จุดเปลี่ยนคืออะไรและเห็นในภาพตรงไหน",
  "unverified": ["ข้อเท็จจริงที่ต้องตรวจ"],
  "caption": "แคปชันโพสต์ 1-2 ประโยค ไม่มีอีโมจิ",
  "hashtags": ["#..."]
}}

ชื่อสินค้า: {title}

ข้อมูลจากหน้าสินค้า:
{source}"##,
        library = library_doc(None),
        styles = STYLES.iter().map(|(id, look, suits)| format!("- {id}: {look} เหมาะกับ {suits}")).collect::<Vec<_>>().join("
"),
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

/// The latest other story clips, newest first: (angle, one line describing the story).
fn recent_stories(app: &App, except: &str) -> Vec<(String, String)> {
    app.jobs().into_iter().filter(|j| j.kind == KIND && j.id != except).take(8).filter_map(|j| {
        let s = load_script(&sdir(app, &j.id)).ok()?;
        let first = s.rows.first().map(|r| r.vo.clone()).unwrap_or_default();
        Some((if s.angle.is_empty() { "twist".into() } else { s.angle }, format!("\"{}\" กฎ: {} · เปิดเรื่อง: {}", s.title, s.rule, first)))
    }).collect()
}

/// An angle the last three clips did not use, picked by the job's seed.
pub fn pick_angle(seed: u64, recent: &[String]) -> &'static str {
    let start = (seed % ANGLES.len() as u64) as usize;
    let fresh = (0..ANGLES.len()).map(|k| ANGLES[(start + k) % ANGLES.len()].0).find(|a| !recent.iter().take(3).any(|r| r == a));
    fresh.unwrap_or(ANGLES[start].0)
}

/// Why the story is not about this product, or None when it is (or when the check itself cannot run).
async fn off_topic(app: &App, title: &str, source: &str, s: &Script, recent: &[String]) -> Option<String> {
    let cfg = app.cfg.read().await.clone();
    let story: Vec<&str> = s.rows.iter().map(|r| r.vo.as_str()).collect();
    // the turn and the row that explains it: judged as a whole story, an unrelated reveal slipped through
    let reveal: Vec<&str> = turn_index(s).map(|t| s.rows.iter().skip(t).take(2).map(|r| r.vo.as_str()).collect()).unwrap_or_default();
    let prompt = format!(
        "ตรวจบทโฆษณาสั้นนี้ ตอบ JSON อย่างเดียว: {{\"fits\": true หรือ false, \"reason\": \"เหตุผลสั้นๆ\"}}
fits เป็น true เมื่อผ่านทั้งสามข้อ:
1. ปัญหาหลักของเรื่องคือสิ่งที่สินค้านี้ใช้แก้โดยตรงตามวิธีใช้ปกติของมัน และคนดูดูจบแล้วรู้ว่าสินค้าคืออะไร
2. สิ่งที่เฉลยในจุดเปลี่ยน (ด้านล่าง) คือสาเหตุที่สินค้านี้กำจัดได้ตรงๆ ถ้าใช้สินค้าแล้วสาเหตุนั้นยังอยู่ (เช่น เฉลยว่าปลั๊กโคมไฟหลวม แต่สินค้าเป็นเครื่องกล่อมนอน) ให้ fits เป็น false
3. สินค้าที่เข้ามาตอนท้ายพูดถึงการแก้สาเหตุนั้น
fits เป็น false เมื่อเรื่องเป็นเรื่องของสินค้าประเภทอื่น และสินค้านี้ถูกยัดเข้ามาเป็นตัวช่วยข้างๆ
fits เป็น false ด้วย ถ้าสถานการณ์ เวลา หรือกฎ ซ้ำหรือคล้ายมากกับเรื่องที่ช่องเคยทำ:
{done}

สินค้า: {title}
ข้อมูลสินค้า (ย่อ): {info}

จุดเปลี่ยนและเฉลย:
{reveal}

บท:
{story}",
        reveal = if reveal.is_empty() { "(ไม่พบ)".to_string() } else { reveal.join("\n") },
        info = source.chars().take(1500).collect::<String>(),
        story = story.join("\n"),
        done = if recent.is_empty() { "(ยังไม่มี)".to_string() } else { recent.join("\n") },
    );
    let provider = cfg.director.first()?;
    let reply = llm::complete(provider, &cfg, &prompt).await.ok()?;
    let v: Value = parse(&reply).ok()?;
    (v["fits"] == json!(false)).then(|| v["reason"].as_str().unwrap_or("เรื่องไม่เกี่ยวกับการใช้สินค้า").to_string())
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
        let mut last_reply: Option<String>;
        for _ in 0..3 {
            let reply = llm::complete(provider, &cfg, &prompt).await;
            last_reply = reply.as_ref().ok().map(|r| r.chars().take(12_000).collect());
            let problems = match reply {
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
            // send the answer back with what is wrong, so the AI fixes those points instead of writing a new story
            prompt = format!("{base}\n\nคำตอบรอบก่อนผิดกฎต่อไปนี้ ให้แก้เฉพาะจุดเหล่านี้ ส่วนอื่นคงไว้ แล้วตอบ JSON ใหม่ทั้งหมด:\n- {}", problems.join("\n- "));
            if let Some(previous) = &last_reply {
                prompt.push_str(&format!("\n\nคำตอบรอบก่อน:\n{previous}"));
            }
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

fn film_json(s: &Script, seed: u64) -> Value {
    let scenes: Vec<Value> = s.rows.iter().enumerate().map(|(i, r)| json!({"line": i + 1, "cuts": r.cuts})).collect();
    // the seed picks wall colour, clothes and the cat, so clips from the same three rooms do not look alike
    let subject = json!({"label": s.subject_label.trim(), "note": s.subject_note.trim()});
    let style = if s.style.is_empty() { "3d" } else { s.style.as_str() };
    json!({"set": set_of(&s.set).map_or("kitchen", |d| d.name), "style": style, "seed": seed % 1000, "subject": subject, "scenes": scenes})
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
    std::fs::write(src.join("film.json"), serde_json::to_string_pretty(&film_json(s, job.seed))?)?;
    std::fs::write(src.join("episode.json"), serde_json::to_string_pretty(&episode_json(s))?)?;
    std::fs::copy(dir.join("src/lines.json"), src.join("lines.json"))?;
    let custom = dir.join("custom.tsx");
    std::fs::copy(if custom.is_file() { custom } else { src.join("custom.default.tsx") }, src.join("custom.tsx"))?;
    let assets = app.job_dir(&job.id).join("pub/assets");
    for i in 0..6 {
        let to = public.join(if i == 0 { "product.png".to_string() } else { format!("img{i}.png") });
        let from = assets.join(format!("img{i}.png"));
        if from.is_file() {
            std::fs::copy(from, to)?;
        } else if i > 0 {
            let _ = std::fs::remove_file(to); // a photo of the previous job must never show up in this one
        }
    }
    Ok(())
}

/// A photo card may only point at a photo this product really has.
fn fix_photos(s: &mut Script, images: usize) {
    for card in s.rows.iter_mut().flat_map(|r| &mut r.cuts).filter_map(|c| c.card.as_mut()) {
        let missing = card["src"].as_str().is_some_and(|src| (1..=5).any(|i| src == format!("img{i}.png") && i >= images));
        if missing {
            card["src"] = json!("product.png");
        }
    }
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
    let twist = turn_index(s).map_or(1, |i| i + 1);
    // the room tone follows the timeline, so it is rebuilt with every draft
    std::fs::write(dir.join("timeline.json"), json!({"acts": {"hook": "L1", "turn": format!("L{twist}"), "hero": format!("L{twist}"), "end": "END"}}).to_string())?;
    py(app, dir, "sound.py", &["room", "."]).await.context("สร้างเสียงบรรยากาศไม่สำเร็จ")?;
    if !dir.join("vo/sfx/impact.wav").is_file() {
        py(app, dir, "sound.py", &["sfx", "vo/sfx"]).await?;
    }
    let mix = json!({
        "video": "out/raw.mp4", "voice": "vo/vo_aligned.wav", "out": "draft.mp4",
        "bgm": {"file": "vo/room.wav", "volume": 0.5}, "clicks_volume": 0.9,
        "sfx": [
            {"file": "vo/sfx/riser.wav", "at": format!("L{twist}+0.4"), "volume": 0.5},
            {"file": "vo/sfx/impact.wav", "at": format!("L{}-0.1", (twist + 1).min(s.rows.len())), "volume": 0.7},
        ],
    });
    std::fs::write(dir.join("mix.json"), mix.to_string())?;
    py(app, dir, "mix.py", &[]).await.context("ผสมเสียงไม่สำเร็จ")?;
    pipeline::duration(&dir.join("draft.mp4")).await
}

/// Everything the owner should see on the review page before confirming.
fn warnings(dir: &Path, s: &Script, seconds: f64) -> Vec<String> {
    let mut out: Vec<String> = s.unverified.iter().map(|f| format!("ยังไม่ได้ตรวจ: {f}")).collect();
    if !s.set_note.trim().is_empty() {
        out.push(format!("เรื่องไม่เข้ากับฉากในคลังพอดี: {}", s.set_note.trim()));
    }
    if let Ok(note) = std::fs::read_to_string(dir.join("custom.note")) {
        out.extend(note.lines().filter(|l| !l.trim().is_empty()).map(String::from));
    }
    if let Ok(rows) = std::fs::read_to_string(dir.join("vo/estimated.txt")) {
        out.push(format!("ระบบถอดเสียงแถว {} ไม่ชัด จึงประมาณเวลาเอง เล่นฉากเหล่านี้ดูว่าภาพกับเสียงตรงกันไหม", rows.trim()));
    }
    if seconds > 60.0 {
        out.push(format!("คลิปยาว {seconds:.1} วินาที เกิน 60 วินาที"));
    }
    out
}

/* ─── per-clip pieces: the product model and the twist prop, written by Claude Code ─── */
// jobs/story-<id>/story/custom.tsx     accepted code (copied to story/src/custom.tsx before rendering)
// jobs/story-<id>/story/custom.note    why there is none (shown as a warning); its presence stops a second try
// jobs/story-<id>/story/custom_N.jpg   the check frames: 0 closed, 1 open, 2 twist prop

const CUSTOM_IMPORTS: [&str; 3] = ["react", "three", "./kit/three"];
const CUSTOM_BANNED: [&str; 16] = [
    "require(", "import(", "import \"", "import '", "fetch(", "XMLHttpRequest", "WebSocket", "eval(", "Function(", "process.", "globalThis",
    "localStorage", "document.cookie", "http://", "https://", "staticFile",
];

/// Why a custom.tsx is refused before it is compiled. The code runs inside the renderer's browser,
/// so it may draw with the kit and nothing else: no other modules, no network, no files.
pub fn check_custom(code: &str) -> Vec<String> {
    let mut errs = Vec::new();
    if code.len() > 24_000 {
        errs.push("ไฟล์ยาวเกิน 24,000 ตัวอักษร".to_string());
    }
    for name in ["Product", "Twist"] {
        if !code.contains(&format!("export const {name}")) {
            errs.push(format!("ต้องมี export const {name} (เป็น component หรือ null)"));
        }
    }
    for (i, _) in code.match_indices("from") {
        let rest = code[i + 4..].trim_start();
        let Some(quote) = rest.chars().next().filter(|c| *c == '"' || *c == '\'') else { continue };
        let spec: String = rest[1..].chars().take_while(|c| *c != quote).collect();
        if !CUSTOM_IMPORTS.contains(&spec.as_str()) {
            errs.push(format!("import ได้เฉพาะ react และ ./kit/three ไม่ใช่ \"{spec}\""));
        }
    }
    for word in CUSTOM_BANNED {
        if code.contains(word) {
            errs.push(format!("ห้ามใช้ {word}"));
        }
    }
    errs
}

/// The code inside the reply's fenced block.
fn fenced(reply: &str) -> Option<String> {
    let body = &reply[reply.find("```")? + 3..];
    let body = &body[body.find('\n')? + 1..];
    Some(format!("{}\n", body[..body.rfind("```")?].trim()))
}

fn custom_prompt(s: &Script, title: &str, photos: &[String], current: Option<&str>, instruction: Option<&str>) -> String {
    let twist = if s.twist_prop.trim().is_empty() { "คลิปนี้ไม่ใช้ ให้ export const Twist: React.FC | null = null;".to_string() } else { format!("{} (สูงไม่เกิน 0.14 ม. กว้างไม่เกิน 0.12 ม.)", s.twist_prop.trim()) };
    let task = match (current, instruction) {
        (Some(code), Some(ask)) => format!("ไฟล์ custom.tsx ตอนนี้:\n```tsx\n{code}```\n\nเจ้าของสั่งแก้: {ask}\nแก้ตามคำสั่งแล้วตอบไฟล์ใหม่ทั้งไฟล์"),
        _ => "เขียนไฟล์ custom.tsx ใหม่ทั้งไฟล์".to_string(),
    };
    format!(
        r##"คุณกำลังเขียนไฟล์ TypeScript หนึ่งไฟล์ชื่อ custom.tsx สำหรับคลิปโฆษณาแอนิเมชัน 3 มิติ (React Three Fiber ใน Remotion)
ไฟล์นี้มีของสองอย่างที่ต่างกันทุกคลิป: โมเดลสินค้า และของประกอบจุดหักมุม

ก่อนเขียน ให้ใช้เครื่องมือ Read ดูรูปสินค้าจริงเหล่านี้ แล้วทำโมเดลให้รูปทรง สัดส่วน และสีตรงกับของจริง:
{photos}

สินค้า: {title}
เรื่องของคลิป: {explain}

สัญญาของไฟล์ (ผิดข้อใดข้อหนึ่งไฟล์จะถูกปฏิเสธ):
- import ได้แค่ `import React from "react";` และของจาก "./kit/three" เท่านั้น และ import เฉพาะชื่อที่ใช้จริง (โปรเจกต์เปิด noUnusedLocals)
- `export const Product: React.FC<{{ open?: number }}> | null` = โมเดลสินค้า ตั้งอยู่บนจุดกำเนิด (y=0 คือผิวเคาน์เตอร์) สูง 0.15-0.2 ม. กว้างและลึกไม่เกิน 0.16 ม. หันหน้าไปทาง +z
  `open` 0..1 คือฝาหรือส่วนที่เปิดได้ (0 ปิด 1 เปิดสุด) ถ้าสินค้าไม่มีส่วนที่เปิดได้ ไม่ต้องใช้ค่านี้
- `export const Twist: React.FC | null` = ของประกอบจุดหักมุม ตั้งบนจุดกำเนิดเช่นกัน: {twist}
- สร้างจากชิ้นส่วนของ kit เท่านั้น วัสดุด้าน ไม่มีเส้นขอบ หน่วยเป็นเมตร
- ห้ามสุ่ม ห้ามอ่านเวลา ห้ามโหลดไฟล์หรือเครือข่าย ห้าม hook นอกจาก React.useMemo ทุกเฟรมต้องเรนเดอร์ได้ผลเดิม

ชิ้นส่วนใน "./kit/three" (V3 = [x, y, z]):
- Bx: กล่อง props p?: V3, s: V3 (ขนาด), c: สี, e?: สีเรืองแสง, ei?: number, r?: ความด้าน, rx? ry? rz?: มุมหมุน, o?: ความทึบ
- Cy: ทรงกระบอก props p?: V3, r: รัศมีบน, r2?: รัศมีล่าง, h: สูง, c, e?, ei?, rx?, rz?, seg?: จำนวนเหลี่ยม
- Sp: ทรงกลม props p?: V3, r, c, e?, ei?, sc?: V3 (ยืดหด)
- Pl: แผ่นระนาบหันไป +z props p?: V3, s: [กว้าง, สูง], c, e?, ei?, ry?, rx?, map?: texture, o?
- Glow: แสงฟุ้ง props p: V3, s?: ขนาด, c?, o?
- textTex(text, w, h, bg, fg, size, key): texture ตัวหนังสือบนพื้นสี ใช้กับ map ของ Pl (key ต้องไม่ซ้ำกัน)
- ใช้ <group position={{[x, y, z]}} rotation={{[rx, ry, rz]}}> จัดกลุ่มและทำบานพับได้

ตัวอย่างไฟล์ที่ถูกต้อง (ของสินค้าอื่น ห้ามลอก ใช้ดูรูปแบบเท่านั้น):
```tsx
{sample}```

{task}
ตอบเป็นโค้ดทั้งไฟล์ในบล็อก ```tsx บล็อกเดียว ไม่ต้องมีคำอธิบายอื่น"##,
        photos = photos.iter().map(|p| format!("- {p}")).collect::<Vec<_>>().join("\n"),
        explain = s.explain.trim(),
        sample = include_str!("../../story/sample/custom.tsx"),
    )
}

/// Compiles the code and renders its check frames. Leaves it in the renderer either way; the caller stages again.
async fn try_custom(app: &App, dir: &Path, code: &str) -> Result<()> {
    let errs = check_custom(code);
    if !errs.is_empty() {
        bail!("{}", errs.join("; "));
    }
    let story = app.root.join("story");
    std::fs::write(story.join("src/custom.tsx"), code)?;
    // tsc reports on stdout, so this cannot go through pipeline::sh (which keeps stderr)
    let tsc = tokio::process::Command::new("node").args(["node_modules/typescript/bin/tsc", "--noEmit", "-p", "."]).current_dir(&story).kill_on_drop(true).output().await.context("เรียก TypeScript ไม่ได้")?;
    if !tsc.status.success() {
        bail!("คอมไพล์ไม่ผ่าน: {}", String::from_utf8_lossy(&tsc.stdout).chars().take(900).collect::<String>());
    }
    let frames: Vec<String> = (0..3).map(|i| format!("{i}:{}", dir.join(format!("custom_{i}.jpg")).to_string_lossy())).collect();
    let mut args = vec!["still.mjs", "CustomCheck"];
    args.extend(frames.iter().map(String::as_str));
    story_node(app, &args, &[]).await.context("เรนเดอร์ภาพตรวจไม่ผ่าน")?;
    Ok(())
}

/// Asks Claude Code for this clip's custom.tsx: two rounds, each compiled and rendered before it is accepted.
/// `instruction` = the owner's change to an existing file.
async fn make_custom(app: &App, job: &Job, dir: &Path, s: &Script, instruction: Option<&str>) -> Result<()> {
    need(llm::has_claude_code().await, "ไม่พบ Claude Code ในเครื่อง (ต้องติดตั้งและล็อกอินก่อน)")?;
    let jdir = app.job_dir(&job.id);
    let photos: Vec<String> = (0..3).map(|i| jdir.join(format!("pub/assets/img{i}.png"))).filter(|p| p.is_file()).map(|p| p.to_string_lossy().to_string()).collect();
    let file = dir.join("custom.tsx");
    let current = std::fs::read_to_string(&file).ok();
    let base = custom_prompt(s, &job.title, &photos, current.as_deref(), instruction);
    let mut prompt = base.clone();
    let mut last = String::new();
    for _ in 0..2 {
        let cfg = app.cfg.read().await.clone();
        let reply = llm::claude_code(&cfg, &prompt, &jdir).await?;
        let problem = match fenced(&reply) {
            None => "คำตอบไม่มีบล็อกโค้ด ```tsx".to_string(),
            Some(code) => match try_custom(app, dir, &code).await {
                Ok(()) => {
                    std::fs::write(&file, code)?;
                    return Ok(());
                }
                Err(e) => format!("{e:#}"),
            },
        };
        prompt = format!("{base}\n\nไฟล์รอบก่อนถูกปฏิเสธเพราะ: {problem}\nแก้แล้วตอบไฟล์ใหม่ทั้งไฟล์");
        last = problem;
    }
    bail!("ไฟล์ที่ Claude เขียนไม่ผ่านการตรวจใน 2 รอบ: {last}")
}

/// Draft stage: a missing or broken model never fails the job. The product is then shown as the real shop photo.
async fn custom_stage(app: &App, job: &Job, dir: &Path, s: &Script) -> Result<()> {
    let note = dir.join("custom.note");
    if dir.join("custom.tsx").is_file() || note.is_file() {
        return Ok(());
    }
    if let Err(e) = make_custom(app, job, dir, s, None).await {
        std::fs::write(note, format!("ไม่มีโมเดล 3 มิติของสินค้า ใช้รูปจริงในกรอบแทน: {e:#}\n"))?;
    }
    Ok(())
}

/// Scenes whose picture depends on custom.tsx.
fn uses_custom(row: &Row) -> bool {
    row.cuts.iter().any(|c| {
        // photo and price beats show the room, with the model on the counter, soft behind the card
        c.shot.starts_with("product") || matches!(c.shot.as_str(), "photo" | "price") || c.state.as_ref().is_some_and(|m| ["product", "twist"].iter().any(|k| m.get(*k) == Some(&json!(true))))
    })
}

/* ─── the job ─── */

#[derive(Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "lowercase")]
enum Todo {
    Edit { scene: usize, instruction: String },
    Export,
    Restyle { style: String },
}

pub async fn stages(app: &App, job: &mut Job) -> Result<()> {
    let dir = sdir(app, &job.id);
    std::fs::create_dir_all(dir.join("src"))?;
    let todo_file = dir.join("todo.json");
    let todo: Option<Todo> = std::fs::read_to_string(&todo_file).ok().and_then(|r| serde_json::from_str(&r).ok());
    let result = match todo {
        Some(Todo::Edit { scene, instruction }) => edit_scene(app, job, &dir, scene, &instruction).await,
        Some(Todo::Export) => export(app, job, &dir).await,
        Some(Todo::Restyle { style }) => restyle(app, job, &dir, &style).await,
        None => draft(app, job, &dir).await,
    };
    let _ = std::fs::remove_file(todo_file);
    // a failed edit or export must not throw away a reviewable draft: report it and go back to review
    if let (Err(e), true) = (&result, dir.join("draft.mp4").is_file() && job.state != "done") {
        job.warnings.retain(|w| !w.starts_with("ทำไม่สำเร็จ"));
        job.warnings.push(format!("ทำไม่สำเร็จ: {e:#}"));
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

    step(job, "1/7 เตรียมรูป")?;
    let assets = pipeline::assets(app, &jdir, &product).await?;

    step(job, "2/7 AI เขียนบทและวางช็อต")?;
    let script = match load_script(dir) {
        Ok(s) => s,
        Err(_) => {
            let source: String = format!("{}\n{}", product.title, product.text).chars().take(7000).collect();
            let banned = pipeline::banned_words(&app.root);
            let recent = recent_stories(app, &job.id);
            let angles: Vec<String> = recent.iter().map(|r| r.0.clone()).collect();
            let done: Vec<String> = recent.into_iter().map(|r| r.1).collect();
            let angle = pick_angle(job.seed, &angles);
            let prompt = script_prompt(&product.title, &source, assets.images.len(), angle, &done);
            let mut s: Script = ask(app, job, &prompt, |s: &Script| validate(s, &source, &banned)).await?;
            // a second look: is this really a story about what the product does? (an AI drifts to a story it likes better)
            for _ in 0..2 {
                let Some(reason) = off_topic(app, &product.title, &source, &s, &done).await else { break };
                let again = format!("{prompt}

เรื่องที่เขียนรอบก่อนถูกปฏิเสธ: {reason}\nเขียนเรื่องใหม่ทั้งเรื่อง ที่ปัญหาเป็นสิ่งที่สินค้านี้แก้ได้ตรงๆ และไม่ซ้ำกับเรื่องที่ช่องเคยทำ");
                s = ask(app, job, &again, |s: &Script| validate(s, &source, &banned)).await?;
            }
            fix_photos(&mut s, assets.images.len());
            // the owner chose a style before the AI wrote: theirs wins, the AI's pick stays as the recommendation
            s.recommended = if s.style.is_empty() { "3d".into() } else { s.style.clone() };
            if !job.style.is_empty() {
                s.style = job.style.clone();
            }
            save_script(dir, &s)?;
            s
        }
    };
    std::fs::write(dir.join("script.md"), script_md(&script))?;
    job.warnings = warnings(dir, &script, 0.0);

    step(job, "3/7 พากย์เสียง")?;
    if !dir.join("vo/takeA.mp3").is_file() {
        let cfg = app.cfg.read().await.clone();
        need(!cfg.keys.gemini.is_empty(), "เสียงพากย์ต้องใช้ Gemini API key ใส่ได้ในหน้าตั้งค่า")?;
        let args = ["voice.mjs", &dir.to_string_lossy(), &cfg.voice];
        let envs = [("GEMINI_API_KEY", cfg.keys.gemini.as_str())];
        // one more try: the voice service sometimes drops a request
        if story_node(app, &args, &envs).await.is_err() {
            story_node(app, &args, &envs).await.context("พากย์เสียงไม่สำเร็จ")?;
        }
    }

    step(job, "4/7 จับเวลาเสียง")?;
    if !dir.join("src/lines.json").is_file() {
        py(app, dir, "transcribe.py", &["vo/takeA.mp3", "--lang", "th"]).await.context("ถอดเสียงไม่สำเร็จ")?;
        let mut aligned = py(app, dir, "align.py", &["vo/takeA.mp3"]).await.unwrap_or_default();
        if !aligned.contains("estimated: none") {
            // the small model garbles Thai now and then; the medium one is slower but hears it better
            py(app, dir, "transcribe.py", &["vo/takeA.mp3", "--lang", "th", "--model", "medium"]).await.context("ถอดเสียงไม่สำเร็จ")?;
            aligned = py(app, dir, "align.py", &["vo/takeA.mp3"]).await.context("จับคู่เสียงกับบทไม่สำเร็จ")?;
        }
        let guessed = aligned.lines().find_map(|l| l.strip_prefix("estimated: ")).filter(|r| *r != "none").map(str::to_string);
        if let Some(rows) = guessed {
            std::fs::write(dir.join("vo/estimated.txt"), &rows)?;
        }
        if !aligned.contains("overlaps: 0") {
            let rows: Vec<&str> = aligned.lines().filter(|l| l.contains("overlaps previous")).filter_map(|l| l.split_whitespace().next()).collect();
            bail!("จับเวลาเสียงกับบทไม่ลงตัวที่แถว {} ลองสร้างใหม่", rows.join(", "));
        }
        // breathe before and after the twist line
        let twist = turn_index(&script).map_or(0, |i| i + 1);
        std::fs::write(dir.join("vo/pauses.json"), json!({(twist.max(2) - 1).to_string(): 0.7, twist.to_string(): 0.5}).to_string())?;
        py(app, dir, "splice.py", &[]).await.context("จัดเวลาเสียงไม่สำเร็จ")?;
    }

    step(job, "5/7 Claude ทำโมเดลสินค้า")?;
    stage_renderer(app, job, dir, &script)?;
    custom_stage(app, job, dir, &script).await?;

    step(job, "6/7 เรนเดอร์ทีละฉาก")?;
    stage_renderer(app, job, dir, &script)?;
    let missing = || -> Vec<usize> { (1..=script.rows.len()).filter(|n| !dir.join(format!("segs/seg_{n:02}.mp4")).is_file()).collect() };
    if !missing().is_empty() && render_scenes(app, dir, &missing()).await.is_err() {
        // scenes that did render are kept; only the rest is tried once more
        render_scenes(app, dir, &missing()).await?;
    }

    step(job, "7/7 รวมฉบับร่าง")?;
    job.seconds = build_draft(app, dir, &script).await?;
    job.warnings = warnings(dir, &script, job.seconds);
    job.state = "review".into();
    job.stage = "รอตรวจ".into();
    Ok(())
}

fn edit_prompt(s: &Script, scene: usize, instruction: &str) -> String {
    let row = &s.rows[scene - 1];
    format!(
        r##"นี่คือฉากที่ {scene} ของคลิปโฆษณาแอนิเมชัน 3 มิติ เจ้าของสั่งแก้ ให้เลือกวิธีแก้ที่เบาที่สุดที่ทำตามคำสั่งได้:
- "picture": แก้ภาพของฉากนี้ (มุมกล้อง ท่า การ์ด ข้อความบนการ์ด state) ตอบ cuts ใหม่ ห้ามเปลี่ยนคำพูด
- "voice": เจ้าของสั่งเปลี่ยนคำพูดของฉากนี้ ตอบ vo และ sub ใหม่ (vo: คั่นวลีด้วยเว้นวรรค ตัวเลขเขียนเป็นคำไทย ยาวใกล้เคียงของเดิม) จะใส่ cuts ใหม่ด้วยก็ได้
- "model": เจ้าของสั่งแก้รูปร่างหรือสีของโมเดลสินค้า 3 มิติ หรือของประกอบจุดหักมุม ตอบ model เป็นคำสั่งที่ชัดเจนสำหรับคนทำโมเดล

บทพากย์ของฉากตอนนี้: {vo}
คำแปล: {sub}
แผนภาพตอนนี้: {cuts}
คำสั่งแก้จากเจ้าของ: {instruction}

{library}

ตอบเป็น JSON อย่างเดียว:
{{"kind": "picture", "cuts": [ ...1-2 cuts ตามรูปแบบเดิม... ], "vo": "", "sub": "", "model": "", "note": "สรุปสั้นๆ ว่าแก้อะไร หรือเหตุผลถ้าคำสั่งทำไม่ได้ด้วยคลังนี้"}}"##,
        vo = row.vo,
        sub = row.sub,
        cuts = serde_json::to_string(&row.cuts).unwrap_or_default(),
        library = library_doc(set_of(&s.set)),
    )
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct SceneEdit {
    kind: String,
    cuts: Vec<Cut>,
    vo: String,
    sub: String,
    model: String,
    note: String,
}

/// The script after an edit, or why the edit is refused.
fn apply_edit(s: &Script, scene: usize, e: &SceneEdit, source: &str, banned: &[String]) -> Result<Script, Vec<String>> {
    let mut next = s.clone();
    let Some(row) = next.rows.get_mut(scene.wrapping_sub(1)) else { return Err(vec![format!("ไม่มีฉากที่ {scene}")]) };
    match e.kind.as_str() {
        "model" => return if e.model.trim().is_empty() { Err(vec!["kind model ต้องมีคำสั่งใน model".into()]) } else { Ok(next) },
        "voice" => {
            if e.vo.trim().is_empty() || e.sub.trim().is_empty() {
                return Err(vec!["kind voice ต้องมี vo และ sub ใหม่".into()]);
            }
            row.vo = e.vo.trim().to_string();
            row.sub = e.sub.trim().to_string();
            if !e.cuts.is_empty() {
                row.cuts = e.cuts.clone();
            }
        }
        _ => {
            if e.cuts.is_empty() {
                return Err(vec!["kind picture ต้องมี cuts".into()]);
            }
            row.cuts = e.cuts.clone();
        }
    }
    // only what this edit broke: a problem that was already in the script is not the edit's to fix
    let old = validate(s, source, banned);
    let errs: Vec<String> = validate(&next, source, banned).into_iter().filter(|e| !old.contains(e)).collect();
    if errs.is_empty() { Ok(next) } else { Err(errs) }
}

/// Re-voices one line inside its old time slot, so no other scene moves. Returns a warning if the new line had to be sped up.
async fn revoice(app: &App, dir: &Path, scene: usize, row: &Row) -> Result<Option<String>> {
    let cfg = app.cfg.read().await.clone();
    need(!cfg.keys.gemini.is_empty(), "เสียงพากย์ต้องใช้ Gemini API key ใส่ได้ในหน้าตั้งค่า")?;
    std::fs::write(dir.join("vo/fix.txt"), row.vo.replace(' ', ""))?;
    story_node(app, &["voice.mjs", &dir.to_string_lossy(), &cfg.voice, "--fix"], &[("GEMINI_API_KEY", cfg.keys.gemini.as_str())]).await.context("พากย์ประโยคใหม่ไม่สำเร็จ")?;
    let seconds = pipeline::duration(&dir.join("vo/fix.mp3")).await?;
    // the captions read the line's text from here
    let file = dir.join("vo/lines.json");
    let mut lines: Value = serde_json::from_str(&std::fs::read_to_string(&file)?)?;
    let line = lines["lines"].get_mut(scene - 1).ok_or_else(|| anyhow!("ไม่มีแถว {scene} ในไฟล์จับเวลา"))?;
    line["th"] = json!(row.vo);
    line["en"] = json!(row.sub);
    std::fs::write(&file, serde_json::to_string(&lines)?)?;
    let out = py(app, dir, "revoice.py", &["vo/fix.mp3", &json!({scene.to_string(): [0.0, seconds]}).to_string()]).await.context("ใส่เสียงประโยคใหม่ไม่สำเร็จ")?;
    py(app, dir, "splice.py", &[]).await.context("จัดเวลาเสียงไม่สำเร็จ")?;
    Ok(out.contains("warning:").then(|| format!("ประโยคใหม่ของฉากที่ {scene} ยาวกว่าช่องเวลาเดิม เสียงจึงถูกเร่งให้พอดี ถ้าฟังเร็วไปลองสั่งแก้ให้สั้นลง")))
}

async fn edit_scene(app: &App, job: &mut Job, dir: &Path, scene: usize, instruction: &str) -> Result<()> {
    let script = load_script(dir)?;
    need(scene >= 1 && scene <= script.rows.len(), "ไม่มีฉากนี้")?;
    job.stage = format!("กำลังแก้ฉากที่ {scene}");
    app.save_job(job)?;
    let jdir = app.job_dir(&job.id);
    let product: Product = serde_json::from_str(&std::fs::read_to_string(jdir.join("product.json"))?)?;
    let source: String = format!("{}\n{}", product.title, product.text).chars().take(7000).collect();
    let banned = pipeline::banned_words(&app.root);
    let edit: SceneEdit = ask(app, job, &edit_prompt(&script, scene, instruction), |e: &SceneEdit| apply_edit(&script, scene, e, &source, &banned).err().unwrap_or_default()).await?;
    let next = apply_edit(&script, scene, &edit, &source, &banned).map_err(|e| anyhow!(e.join("; ")))?;

    let mut extra = None;
    let scenes: Vec<usize> = match edit.kind.as_str() {
        "model" => {
            job.stage = "Claude กำลังแก้โมเดล".into();
            app.save_job(job)?;
            stage_renderer(app, job, dir, &next)?;
            let made = make_custom(app, job, dir, &next, Some(edit.model.trim())).await;
            stage_renderer(app, job, dir, &next)?; // back to the accepted file, whatever happened
            made?;
            let _ = std::fs::remove_file(dir.join("custom.note"));
            (1..=next.rows.len()).filter(|n| uses_custom(&next.rows[n - 1])).collect()
        }
        "voice" => {
            job.stage = format!("กำลังพากย์ฉากที่ {scene} ใหม่");
            app.save_job(job)?;
            extra = revoice(app, dir, scene, &next.rows[scene - 1]).await?;
            vec![scene]
        }
        _ => vec![scene],
    };
    save_script(dir, &next)?;
    std::fs::write(dir.join("script.md"), script_md(&next))?;
    job.stage = format!("กำลังเรนเดอร์ฉากที่ {}", scenes.iter().map(|n| n.to_string()).collect::<Vec<_>>().join(", "));
    app.save_job(job)?;
    stage_renderer(app, job, dir, &next)?;
    if !scenes.is_empty() {
        render_scenes(app, dir, &scenes).await?;
    }
    job.seconds = build_draft(app, dir, &next).await?;
    job.warnings = warnings(dir, &next, job.seconds);
    job.warnings.extend(extra);
    if !edit.note.trim().is_empty() {
        job.warnings.push(format!("แก้ฉากที่ {scene}: {}", edit.note.trim()));
    }
    job.state = "review".into();
    job.stage = "รอตรวจ".into();
    Ok(())
}

/// The cover: the film's frame just after the twist line (a face reacting), with the title on it.
async fn cover(app: &App, job: &Job, dir: &Path, s: &Script) -> Result<PathBuf> {
    let out = dir.join("cover.jpg");
    let lines: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("src/lines.json"))?)?;
    let twist = turn_index(s).unwrap_or(0);
    let second = lines["lines"][twist]["t"].as_f64().unwrap_or(1.0) + 0.6;
    stage_renderer(app, job, dir, s)?;
    let still = story_node(app, &["still.mjs", "Cover", &format!("{}:{}", (second * 30.0).round() as u32, out.to_string_lossy())], &[]).await;
    if still.is_err() || !out.is_file() {
        // plain frame of the draft when the titled cover cannot be rendered
        pipeline::sh("ffmpeg", &["-v", "error", "-y", "-ss", &format!("{second:.2}"), "-i", "draft.mp4", "-frames:v", "1", "-q:v", "2", "cover.jpg"], dir, &[]).await.context("ทำปกไม่สำเร็จ")?;
    }
    Ok(out)
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
    job.warnings = warnings(dir, &script, job.seconds);
    match cover(app, job, dir, &script).await {
        Ok(file) => {
            std::fs::copy(&file, jdir.join(pipeline::COVER_FILE))?;
            std::fs::copy(&file, export.join(format!("{}-cover.jpg", job.id)))?;
        }
        Err(e) => job.warnings.push(format!("สร้างปกไม่สำเร็จ: {e:#}")),
    }
    job.state = "done".into();
    job.stage = "ส่งออกแล้ว".into();
    Ok(())
}

/* ─── HTTP ─── */

/// Makes a story job for a product whose page data is already here, and queues it.
/// `style`: the picture style the owner chose up front ("" = let the AI pick).
pub fn create_from(app: &App, base_id: &str, style: &str) -> Result<String> {
    need(style_ok(style), "ไม่มีรูปแบบภาพนี้")?;
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
    // job.style = the owner's choice; the AI still writes its own pick, kept as the recommendation
    let job = Job { id: id.clone(), kind: KIND.into(), style: style.to_string(), title: base.title.clone(), state: "queued".into(), stage: "รอคิว".into(), seed: crate::new_seed(), created: crate::now(), ..Default::default() };
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
    #[serde(default)]
    style: String,
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
        return Ok(Json(json!({"job": create_from(&app, &base.id, &req.style)?, "started": true})));
    }
    // unknown product: reuse the normal link flow, and leave a note so ingest starts the story
    let _ = crate::add_links(State(app.clone()), Json(crate::LinksReq { urls: vec![url.to_string()], style: String::new() })).await?;
    let dir = app.job_dir(&item);
    std::fs::create_dir_all(&dir)?;
    need(style_ok(&req.style), "ไม่มีรูปแบบภาพนี้")?;
    std::fs::write(dir.join("want-story"), &req.style)?; // the chosen style waits here until the product arrives
    Ok(Json(json!({"job": format!("story-{item}"), "started": false})))
}

/// Called by ingest: if this product was asked for from the Story page, start its story now.
pub fn on_ingest(app: &App, base_id: &str) {
    let marker = app.job_dir(base_id).join("want-story");
    let style = std::fs::read_to_string(&marker).unwrap_or_default();
    if marker.is_file() && create_from(app, base_id, style.trim()).is_ok() {
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
    // the files change in place when a scene is redone: the page adds this to their addresses so it never shows an old one
    let stamp = std::fs::metadata(dir.join("draft.mp4")).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
    let caption = std::fs::read_to_string(app.job_dir(&id).join("caption.txt")).unwrap_or_default();
    Ok(Json(json!({"job": job, "script": script, "scenes": scenes, "stamp": stamp, "model3d": dir.join("custom.tsx").is_file(), "caption": caption})))
}

/// What a story job needs on this machine. Checked when the Story page opens, so a missing tool is known before a job fails.
pub async fn health(State(app): State<Shared>) -> Json<Value> {
    let here = Path::new(".");
    let mut missing: Vec<&str> = Vec::new();
    if pipeline::sh("ffmpeg", &["-version"], here, &[]).await.is_err() {
        missing.push("ไม่พบ ffmpeg");
    }
    if pipeline::sh("python", &["-c", "import faster_whisper, numpy"], here, &[]).await.is_err() {
        missing.push("การจับเวลาเสียงต้องใช้ Python กับ faster-whisper และ numpy (python -m pip install faster-whisper numpy)");
    }
    if !app.root.join("story/node_modules/remotion").is_dir() {
        missing.push("ยังไม่ได้ติดตั้งตัวเรนเดอร์ 3 มิติ (รัน npm install ในโฟลเดอร์ story)");
    }
    if app.cfg.read().await.keys.gemini.is_empty() {
        missing.push("ยังไม่ได้ใส่ Gemini API key สำหรับเสียงพากย์ (หน้าตั้งค่า)");
    }
    let claude = llm::has_claude_code().await;
    Json(json!({"missing": missing, "claude": claude}))
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

/// Same script, same voice, new picture: every scene is rendered again in the chosen style.
async fn restyle(app: &App, job: &mut Job, dir: &Path, style: &str) -> Result<()> {
    need(style_ok(style) && !style.is_empty(), "ไม่มีรูปแบบภาพนี้")?;
    let mut script = load_script(dir)?;
    if script.recommended.is_empty() {
        script.recommended = if script.style.is_empty() { "3d".into() } else { script.style.clone() };
    }
    script.style = style.to_string();
    save_script(dir, &script)?;
    job.stage = "กำลังเรนเดอร์ทุกฉากในรูปแบบใหม่".into();
    app.save_job(job)?;
    stage_renderer(app, job, dir, &script)?;
    let all: Vec<usize> = (1..=script.rows.len()).collect();
    render_scenes(app, dir, &all).await?;
    job.seconds = build_draft(app, dir, &script).await?;
    job.warnings = warnings(dir, &script, job.seconds);
    job.state = "review".into();
    job.stage = "รอตรวจ".into();
    Ok(())
}

#[derive(Deserialize)]
pub struct StyleReq {
    style: String,
}
pub async fn set_style(State(app): State<Shared>, UrlPath(id): UrlPath<String>, Json(req): Json<StyleReq>) -> Api<Json<Value>> {
    need(!req.style.is_empty() && style_ok(&req.style), "ไม่มีรูปแบบภาพนี้")?;
    queue_todo(&app, &id, &Todo::Restyle { style: req.style })?;
    Ok(Json(json!({"ok": true})))
}

pub async fn styles() -> Json<Value> {
    Json(json!(STYLES.iter().map(|(id, look, suits)| json!({"id": id, "look": look, "suits": suits})).collect::<Vec<_>>()))
}

pub async fn confirm(State(app): State<Shared>, UrlPath(id): UrlPath<String>) -> Api<Json<Value>> {
    queue_todo(&app, &id, &Todo::Export)?;
    Ok(Json(json!({"ok": true})))
}

/// Try a failed job again from the stage that failed: the script, voice and rendered scenes it already has are kept.
pub async fn retry(State(app): State<Shared>, UrlPath(id): UrlPath<String>) -> Api<Json<Value>> {
    let _mutation = app.begin_job_mutation()?;
    let mut job = story_job(&app, &id)?;
    need(job.state == "error", "ลองต่อได้เฉพาะงานที่ล้มเหลว")?;
    let _ = std::fs::remove_file(sdir(&app, &id).join("todo.json"));
    job.state = "queued".into();
    job.stage = "รอคิว".into();
    job.error.clear();
    app.save_job(&job)?;
    app.queue.send(id)?;
    Ok(Json(json!({"ok": true})))
}

/// Write a new story for the same product (the old script, voice and scenes go).
pub async fn restart(State(app): State<Shared>, UrlPath(id): UrlPath<String>) -> Api<Json<Value>> {
    let _mutation = app.begin_job_mutation()?;
    let job = story_job(&app, &id)?;
    need(!matches!(job.state.as_str(), "queued" | "running"), "งานนี้อยู่ในคิวหรือกำลังทำอยู่")?;
    let base = id.strip_prefix("story-").unwrap_or(&id);
    Ok(Json(json!({"job": create_from(&app, base, &job.style)?})))
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
    fn asks_for_a_price_only_when_the_page_has_one() {
        assert!(has_price("ราคา ฿179 ส่งฟรี"));
        assert!(has_price("฿ 1,290"));
        assert!(!has_price("ฆ่าเชื้อได้ 99.99% ขนาด 200ml"));
        assert!(script_prompt("x", "ไม่มีราคา", 1, "twist", &[]).contains("ห้ามพูดหรือแต่งราคา"));
        assert!(!script_prompt("x", "฿179", 1, "twist", &[]).contains("ห้ามพูดหรือแต่งราคา"));
        assert!(!library_doc(None).contains("179")); // no real-looking number for the AI to copy
    }

    #[test]
    fn angles_rotate_and_each_has_its_own_turn() {
        // the last three angles are skipped; the seed picks among the rest
        let recent: Vec<String> = ["twist", "myth", "countdown"].map(String::from).to_vec();
        for seed in 0..12 {
            assert!(!recent.contains(&pick_angle(seed, &recent).to_string()), "seed {seed}");
        }
        assert_eq!(pick_angle(1, &[]), ANGLES[1].0);
        let prompt = script_prompt("x", "", 1, "signs", &["\"ตีสอง\" กฎ: อย่าตัก".into()]);
        assert!(prompt.contains("สัญญาณเตือนเล็กๆ สามอย่าง") && prompt.contains("\"ตีสอง\" กฎ: อย่าตัก"));
        assert!(!prompt.contains("ตีสองห้านาที")); // no fixed time for the AI to copy

        // a non-twist story turns where turnRow says, and needs no "ยกเว้นเรื่องเดียว" row
        let mut s = good();
        s.angle = "myth".into();
        s.rows[8].vo = "แต่ความจริงคือ ฝาไม่สนิท".into();
        s.turn_row = 9;
        assert_eq!(validate(&s, SRC, &[]), Vec::<String>::new());
        s.turn_row = 0;
        assert!(validate(&s, SRC, &[]).join("\n").contains("turnRow"));
        s.turn_row = 12; // leaves no room for the product
        assert!(validate(&s, SRC, &[]).join("\n").contains("จุดเปลี่ยน"));
        s.angle = "drama".into();
        assert!(validate(&s, SRC, &[]).join("\n").contains("ไม่มีมุมเล่า"));
    }

    #[test]
    fn accepts_a_valid_story() {
        assert_eq!(validate(&good(), SRC, &[]), Vec::<String>::new());
    }

    #[test]
    fn style_must_come_from_the_library_and_reaches_the_renderer() {
        let mut s = good();
        s.style = "crayon".into();
        assert_eq!(validate(&s, SRC, &[]), Vec::<String>::new());
        assert_eq!(film_json(&s, 1)["style"], "crayon");
        s.style = String::new(); // scripts written before styles existed render in 3D
        assert_eq!(film_json(&s, 1)["style"], "3d");
        s.style = "anime".into();
        assert!(validate(&s, SRC, &[]).join("
").contains("anime"));
    }

    #[test]
    fn rejects_a_story_without_the_formula() {
        let mut s = good();
        s.rows[0].vo = "วันนี้มาแนะนำกระปุกนมผง".into();
        s.rows[8].vo = "แล้วก็พบปัญหา".into();
        let errs = validate(&s, SRC, &[]).join("\n");
        assert!(errs.contains("ถ้า... อย่า..."), "{errs}");
        assert!(errs.contains(TWIST), "{errs}");
        assert!(errs.contains("สินค้าต้องเข้าหลังแถวจุดเปลี่ยน"), "{errs}"); // no twist row = product is never allowed
        // the bedroom draft said "คุณทำถูกทุกอย่าง" twice in a row
        let mut s = good();
        s.rows[7].vo = "คุณทำถูก ทุกอย่าง ตามสัญชาตญาณ".into();
        assert!(validate(&s, SRC, &[]).join("\n").contains("ใช้ได้แถวเดียว"));
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
        for want in ["drone", "fire", "เขียนเป็นคำไทย", "บัว", "ราคา \"99\"", "หลังแถวจุดเปลี่ยน"] {
            assert!(errs.contains(want), "missing {want}: {errs}");
        }
    }

    fn edit(kind: &str) -> SceneEdit {
        SceneEdit { kind: kind.into(), ..Default::default() }
    }

    #[test]
    fn editing_one_scene_leaves_the_others_untouched() {
        let s = good();
        let before = serde_json::to_value(&s).unwrap();
        let after = serde_json::to_value(apply_edit(&s, 3, &SceneEdit { cuts: vec![cut("pet")], ..edit("picture") }, SRC, &[]).unwrap()).unwrap();
        for i in 0..s.rows.len() {
            assert_eq!(before["rows"][i] == after["rows"][i], i != 2, "row {i}");
        }
        assert_eq!(after["rows"][2]["vo"], before["rows"][2]["vo"]); // a picture edit never changes the words
        assert!(apply_edit(&s, 99, &edit("picture"), SRC, &[]).is_err());
        assert!(apply_edit(&s, 0, &edit("picture"), SRC, &[]).is_err());
    }

    #[test]
    fn an_edit_must_still_pass_the_story_rules() {
        let s = good();
        // the product may not move in front of the twist, and new words obey the same rules as the first script
        assert!(apply_edit(&s, 2, &SceneEdit { cuts: vec![cut("product")], ..edit("picture") }, SRC, &[]).is_err());
        assert!(apply_edit(&s, 4, &SceneEdit { vo: "เปิดมาแล้ว 19 วัน".into(), sub: "x".into(), ..edit("voice") }, SRC, &[]).is_err());
        assert!(apply_edit(&s, 9, &SceneEdit { vo: "แล้วก็พบปัญหา".into(), sub: "x".into(), ..edit("voice") }, SRC, &[]).is_err()); // the twist line must stay
        assert!(apply_edit(&s, 4, &edit("voice"), SRC, &[]).is_err_and(|e| e[0].contains("vo")));
        assert!(apply_edit(&s, 4, &edit("model"), SRC, &[]).is_err());

        let voiced = apply_edit(&s, 4, &SceneEdit { vo: "คุณเช็ดมือ ให้แห้งสนิท".into(), sub: "You dry your hands.".into(), ..edit("voice") }, SRC, &[]).unwrap();
        assert_eq!(voiced.rows[3].vo, "คุณเช็ดมือ ให้แห้งสนิท");
        assert_eq!(serde_json::to_value(&voiced.rows[3].cuts).unwrap(), serde_json::to_value(&s.rows[3].cuts).unwrap());
        // a flaw the script already had elsewhere does not block an edit of another scene
        let mut old = good();
        old.rows[5].vo = "ข้างสระบัว".into();
        assert!(apply_edit(&old, 3, &SceneEdit { cuts: vec![cut("pet")], ..edit("picture") }, SRC, &[]).is_ok());
        assert!(apply_edit(&old, 3, &SceneEdit { cuts: vec![cut("drone")], ..edit("picture") }, SRC, &[]).is_err());
        let model = apply_edit(&s, 11,&SceneEdit { model: "ฝาเป็นสีฟ้า".into(), ..edit("model") }, SRC, &[]).unwrap();
        assert_eq!(serde_json::to_value(&model).unwrap(), serde_json::to_value(&s).unwrap()); // a model edit leaves the plan alone
    }

    #[test]
    fn each_set_only_takes_its_own_state() {
        let state = |v: Value| Some(serde_json::from_value(v).unwrap());
        let mut s = good();
        s.set = "bedroom".into();
        s.rows[2].cuts[0].state = state(json!({"cord": "loose", "cold": 1, "twist": true}));
        assert_eq!(validate(&s, SRC, &[]), Vec::<String>::new());
        s.rows[3].cuts[0].state = state(json!({"lid": "off"})); // a kitchen key
        assert!(validate(&s, SRC, &[]).join("\n").contains("ฉาก bedroom ไม่มี state \"lid\""));
        s.set = "garage".into();
        assert!(validate(&s, SRC, &[])[0].contains("ไม่มีฉาก \"garage\""));
        // a script from before sets existed is a kitchen story
        assert_eq!(set_of("").unwrap().name, "kitchen");
        assert_eq!(film_json(&good(), 4321)["set"], "kitchen");
        assert_eq!(film_json(&good(), 4321)["seed"], 321);
        // the prompt for a new story offers every room; an edit only its own
        assert!(["kitchen", "bedroom", "bathroom"].iter().all(|n| library_doc(None).contains(&format!("\"{n}\""))));
        assert!(!library_doc(set_of("bathroom")).contains("\"kitchen\""));
    }

    #[test]
    fn custom_code_may_only_draw_with_the_kit() {
        let sample = include_str!("../../story/sample/custom.tsx");
        assert_eq!(check_custom(sample), Vec::<String>::new());
        assert_eq!(check_custom(include_str!("../../story/src/custom.default.tsx")), Vec::<String>::new());
        let bad = format!("import fs from \"node:fs\";\n{sample}\nconst x = fetch(\"https://example.com\");");
        let errs = check_custom(&bad).join("\n");
        for want in ["node:fs", "fetch(", "https://"] {
            assert!(errs.contains(want), "missing {want}: {errs}");
        }
        assert!(check_custom("export const Product = null;").join("\n").contains("Twist"));
        assert_eq!(fenced("ได้เลย\n```tsx\nconst a = 1;\n```\nจบ").as_deref(), Some("const a = 1;\n"));
        assert_eq!(fenced("no code here"), None);
    }

    #[test]
    fn only_scenes_with_the_product_or_twist_prop_follow_a_model_change() {
        let s = good();
        let hits: Vec<usize> = (1..=s.rows.len()).filter(|n| uses_custom(&s.rows[n - 1])).collect();
        assert_eq!(hits, [11, 12]);
        let mut twist = row("x", "aux");
        twist.cuts[0].state = Some(serde_json::from_value(json!({"twist": true})).unwrap());
        assert!(uses_custom(&twist));
        assert!(!uses_custom(&row("x", "aux")));
    }

    #[test]
    fn photo_cards_fall_back_to_a_photo_that_exists() {
        let mut s = good();
        s.rows[10].cuts[0].card = Some(json!({"type": "photo", "src": "img4.png"}));
        s.rows[11].cuts[0].card = Some(json!({"type": "photo", "src": "img1.png"}));
        fix_photos(&mut s, 3); // img0 (product.png), img1, img2
        assert_eq!(s.rows[10].cuts[0].card.as_ref().unwrap()["src"], "product.png");
        assert_eq!(s.rows[11].cuts[0].card.as_ref().unwrap()["src"], "img1.png");
    }

    #[test]
    fn warnings_carry_everything_the_owner_must_check() {
        let dir = std::env::temp_dir().join(format!("story-warn-{}-{}", std::process::id(), crate::new_seed()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("custom.note"), "ไม่มีโมเดล 3 มิติของสินค้า ใช้รูปจริงในกรอบแทน: x\n").unwrap();
        let mut s = good();
        s.unverified = vec!["นมผงเปิดแล้วใช้ได้สี่สัปดาห์".into()];
        s.set_note = "ไม่มีฉากโรงรถ".into();
        let all = warnings(&dir, &s, 61.2).join("\n");
        for want in ["ยังไม่ได้ตรวจ: นมผง", "ไม่มีฉากโรงรถ", "ใช้รูปจริงในกรอบแทน", "61.2 วินาที"] {
            assert!(all.contains(want), "missing {want}: {all}");
        }
        assert!(warnings(&dir.join("none"), &good(), 55.0).is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn script_md_has_the_narration_block_and_table() {
        let md = script_md(&good());
        assert!(md.contains("| 1 | ถ้าลูกร้องหิว ตอนตีสอง อย่าเพิ่งตักนมผง | x |"));
        assert!(md.contains("```\nถ้าลูกร้องหิวตอนตีสองอย่าเพิ่งตักนมผง "));
    }
}
