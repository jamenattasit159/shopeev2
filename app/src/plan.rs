//! The scene plan: the contract between the AI director and the renderer.
//! Everything the AI returns is checked here before any money is spent on voice or render time.
use serde::{Deserialize, Serialize};

pub const SCENES: [&str; 10] = [
    "hook", "hero", "bigword", "grid", "stamp", "count", "price", "review", "compare", "cta",
];
pub const PALETTES: [&str; 5] = ["sky", "mint", "candy", "sun", "grape"];
pub const STYLES: [(&str, &str); 4] = [
    ("problem-solution", "เปิดด้วยปัญหาที่คนดูเจอจริง แล้วให้สินค้าเป็นทางแก้"),
    ("three-reasons", "เปิดด้วยการบอกว่ามี 3 เหตุผลที่ต้องมี แล้วไล่ทีละข้อ"),
    ("review-summary", "เปิดด้วยสิ่งที่ผู้ซื้อจริงพูดถึง ใช้คะแนนและรีวิวเป็นแกน"),
    ("worth-it", "เปิดด้วยคำถามว่าราคานี้คุ้มไหม แล้วพิสูจน์ด้วยสิ่งที่ได้"),
];
const FPS: f64 = 30.0;
const MAX_LINE: usize = 22;
const BEAT_COUNTS: std::ops::RangeInclusive<usize> = 6..=9;
const MAX_SPOKEN: usize = 240;
const TARGET_SPOKEN: usize = 210;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Facts {
    pub brand: String,
    pub price: String,
    #[serde(rename = "priceBefore")]
    pub price_before: String,
    pub rating: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct PlanBeat {
    pub scene: String,
    pub say: String,
    pub text: Vec<String>,
    pub badges: Vec<String>,
    pub number: Option<u64>,
    pub unit: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Plan {
    pub product: Facts,
    pub beats: Vec<PlanBeat>,
    pub caption: String,
    pub hashtags: Vec<String>,
}

/// Pulls the JSON object out of a model reply that may be wrapped in prose or code fences.
pub fn parse(reply: &str) -> Result<Plan, String> {
    let (a, b) = (reply.find('{'), reply.rfind('}'));
    let json = match (a, b) {
        (Some(a), Some(b)) if b > a => &reply[a..=b],
        _ => return Err("คำตอบไม่มี JSON".into()),
    };
    let mut value: serde_json::Value = serde_json::from_str(json).map_err(|e| format!("JSON ไม่ถูกรูปแบบ: {e}"))?;
    drop_nulls(&mut value);
    serde_json::from_value(value).map_err(|e| format!("JSON ไม่ถูกรูปแบบ: {e}"))
}

/// Models write `"price": null` for "unknown" and `"price": 179` for "179"; accept both.
fn drop_nulls(v: &mut serde_json::Value) {
    match v {
        serde_json::Value::Object(map) => {
            map.retain(|_, x| !x.is_null());
            for (key, x) in map.iter_mut() {
                // every numeric field except these two is declared as text
                if x.is_number() && key != "rating" && key != "number" {
                    *x = serde_json::Value::String(x.to_string());
                }
                drop_nulls(x);
            }
        }
        serde_json::Value::Array(items) => {
            items.retain(|x| !x.is_null());
            items.iter_mut().for_each(drop_nulls);
        }
        _ => {}
    }
}

fn digit_runs(s: &str) -> Vec<String> {
    let clean: String = s.chars().filter(|c| *c != ',').collect();
    clean
        .split(|c: char| !c.is_ascii_digit())
        .filter(|r| !r.is_empty())
        .map(String::from)
        .collect()
}

/// Returns every rule the plan breaks. `source` is the text scraped from the product page.
pub fn validate(plan: &Plan, source: &str, banned: &[String]) -> Vec<String> {
    let mut errs = Vec::new();
    let n = plan.beats.len();
    if !BEAT_COUNTS.contains(&n) {
        errs.push(format!("ต้องมี 6-9 จังหวะ แต่ได้ {n}"));
    }
    if plan.beats.first().map(|b| b.scene.as_str()) != Some("hook") {
        errs.push("จังหวะแรกต้องเป็น hook".into());
    }
    if plan.beats.last().map(|b| b.scene.as_str()) != Some("cta") {
        errs.push("จังหวะสุดท้ายต้องเป็น cta".into());
    }
    let src_digits: String = source.chars().filter(|c| *c != ',').collect();
    let spoken_lengths: Vec<_> = plan.beats.iter().map(|b| b.say.chars().count()).collect();
    let spoken: usize = spoken_lengths.iter().sum();
    // ~10 Thai characters per second at this voice tempo => 15-22 s
    if !(130..=MAX_SPOKEN).contains(&spoken) {
        let mut error = format!("บทพูดรวมต้องยาว 130-{MAX_SPOKEN} ตัวอักษร แต่ได้ {spoken}");
        if spoken > MAX_SPOKEN && BEAT_COUNTS.contains(&n) {
            let limit = TARGET_SPOKEN / n;
            let long_lines = spoken_lengths.iter().enumerate()
                .filter(|&(_, &len)| len > limit)
                .map(|(i, len)| format!("จังหวะ {} ({len})", i + 1))
                .collect::<Vec<_>>()
                .join(", ");
            error.push_str(&format!(" ให้ย่อ say ให้เหลือไม่เกิน {limit} ตัวอักษรใน {long_lines}"));
        }
        errs.push(error);
    }
    for (i, b) in plan.beats.iter().enumerate() {
        let at = format!("จังหวะ {} ({})", i + 1, b.scene);
        if !SCENES.contains(&b.scene.as_str()) {
            errs.push(format!("{at}: ไม่รู้จักฉากนี้"));
            continue;
        }
        if i > 0 && plan.beats[i - 1].scene == b.scene {
            errs.push(format!("{at}: ฉากซ้ำกับจังหวะก่อนหน้า"));
        }
        if b.say.trim().is_empty() {
            errs.push(format!("{at}: ไม่มีบทพูด"));
        }
        let quote = b.scene == "review";
        for t in b.text.iter().chain(b.badges.iter()) {
            let limit = if quote { 110 } else { MAX_LINE };
            if t.chars().count() > limit {
                errs.push(format!("{at}: ข้อความ \"{t}\" ยาวเกิน {limit} ตัวอักษร"));
            }
        }
        match b.scene.as_str() {
            "hook" if !(2..=3).contains(&b.text.len()) => errs.push(format!("{at}: text ต้องมี 2-3 บรรทัด")),
            "grid" if !(3..=4).contains(&b.badges.len()) => errs.push(format!("{at}: badges ต้องมี 3-4 อัน")),
            "stamp" if !(1..=2).contains(&b.badges.len()) => errs.push(format!("{at}: badges ต้องมี 1-2 อัน")),
            "compare" if b.badges.len() != 2 => errs.push(format!("{at}: badges ต้องมี 2 อัน (ปัญหา, ทางแก้)")),
            "count" if b.number.is_none() => errs.push(format!("{at}: ต้องมี number")),
            "price" if plan.product.price.trim().is_empty() => errs.push(format!("{at}: ใช้ฉาก price ไม่ได้เพราะไม่มีราคา")),
            "hero" if plan.product.brand.trim().is_empty() => errs.push(format!("{at}: ใช้ฉาก hero ไม่ได้เพราะไม่มีชื่อแบรนด์")),
            "review" => {
                // a review must be a real one: the whole quote has to exist on the page (spacing aside)
                let squash = |t: &str| t.split_whitespace().collect::<String>();
                let quote = b.text.first().map(|q| squash(q)).unwrap_or_default();
                if b.text.len() != 1 || quote.chars().count() < 15 || !squash(source).contains(&quote) {
                    errs.push(format!("{at}: text ต้องมี 1 บรรทัด เป็นรีวิวจริงยาว 15 ตัวอักษรขึ้นไป คัดลอกตรงตัวจากข้อมูลสินค้า"));
                }
            }
            _ => {}
        }
        let mut all = vec![b.say.clone()];
        all.extend(b.text.iter().cloned());
        all.extend(b.badges.iter().cloned());
        if let Some(num) = b.number {
            all.push(num.to_string());
        }
        for s in &all {
            for run in digit_runs(s) {
                if !src_digits.contains(&run) {
                    errs.push(format!("{at}: ตัวเลข {run} ไม่มีในข้อมูลสินค้า"));
                }
            }
            if let Some(w) = banned.iter().find(|w| !w.is_empty() && s.contains(w.as_str())) {
                errs.push(format!("{at}: มีคำต้องห้าม \"{w}\""));
            }
        }
    }
    if let Some(r) = plan.product.rating {
        if !source.contains(&format!("{r:.1}")) {
            errs.push(format!("คะแนน {r:.1} ไม่มีในข้อมูลสินค้า ถ้าไม่มีคะแนนให้ใส่ null"));
        }
    }
    for p in [&plan.product.price, &plan.product.price_before] {
        for run in digit_runs(p) {
            if !src_digits.contains(&run) {
                errs.push(format!("ราคา {p} ไม่มีในข้อมูลสินค้า"));
            }
        }
    }
    errs
}

/// Frames a beat occupies for a voice line of `seconds`. Short gap after each line; the last beat lingers.
pub fn beat_frames(seconds: f64, last: bool) -> u32 {
    let tail = if last { 0.9 } else { 0.18 };
    (((seconds + tail) * FPS).ceil() as u32).max(36)
}

pub fn prompt(style: (&str, &str), title: &str, page_text: &str, has_clips: bool) -> String {
    let spoken_budgets = BEAT_COUNTS
        .map(|n| format!("{n} จังหวะ: {}", TARGET_SPOKEN / n))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        r##"คุณเป็นผู้กำกับคลิปสั้นขายของบน Shopee Video ความยาว 15-22 วินาที พากย์เสียงผู้ชายพูดลงท้าย "ครับ"
แนวสคริปต์รอบนี้: {style_name} — {style_desc}

ตอบเป็น JSON อย่างเดียว ห้ามมีข้อความอื่น รูปแบบ:
{{
  "product": {{"brand": "ชื่อแบรนด์ตัวอักษรอังกฤษ ไม่เกิน 12 ตัว หรือเว้นว่าง", "price": "ราคาขายปัจจุบันเป็นตัวเลขล้วน หรือเว้นว่าง", "priceBefore": "ราคาก่อนลด หรือเว้นว่าง", "rating": 4.9}},
  "beats": [{{"scene": "...", "say": "ประโยคพากย์ 1 ประโยค", "text": ["ข้อความบนจอ"], "badges": [], "number": null, "unit": null}}],
  "caption": "แคปชันโพสต์ 1-2 ประโยค",
  "hashtags": ["#..."]
}}

ฉากที่เลือกได้ (scene) และสิ่งที่ต้องใส่:
- hook: เปิดคลิป text 2-3 บรรทัดสั้น บรรทัดสุดท้ายแรงสุด
- hero: โชว์สินค้ากับชื่อแบรนด์ text 1 บรรทัดเป็นป้ายสั้น (ใช้ได้เมื่อมี brand)
- bigword: คำเดียวตัวยักษ์ text[0] คือคำเด่น 1-2 คำ text[1] คือคำเสริมสั้น (ไม่ใส่ก็ได้)
- grid: แจก 3-4 ข้อ text[0] คือหัวข้อ badges คือ "อีโมจิ คำสั้น" เช่น "👶 หน้า"
- stamp: ตราประทับ text[0] คือหัวข้อคำเดียว badges 1-2 อัน รูปแบบ "ตัวใหญ่|ตัวเล็ก" เช่น "0%|แอลกอฮอล์"
- count: ตัวเลขวิ่ง ใส่ number และ unit text[0] คือป้ายบน text[1] คือป้ายล่าง (ไม่ใส่ก็ได้)
- price: โชว์ราคา text[0] คือป้ายสั้น (ใช้ได้เมื่อมี price)
- review: text มี 1 บรรทัด คัดข้อความต่อเนื่อง 15-60 ตัวอักษรจากรีวิวจริงของผู้ซื้อในข้อมูล คงคำและการสะกดเดิมทุกตัว ถ้าหาข้อความที่คัดได้ไม่ได้ ให้เลือกฉากอื่น
- compare: badges 2 อัน [ปัญหาเดิม, ผลเมื่อใช้สินค้า] text[0] คือป้ายสั้น
- cta: ปิดคลิป ชวนกดตะกร้าส้ม ไม่ต้องใส่ text

กฎ:
1. มี 6-9 จังหวะ จังหวะแรกเป็น hook จังหวะสุดท้ายเป็น cta ห้ามใช้ฉากเดียวกันติดกัน
2. เลือกจำนวนจังหวะก่อนเขียน แต่ละ say เป็นประโยคสั้นประโยคเดียว ใช้เพดานตัวอักษรต่อ say ตามจำนวนจังหวะทั้งหมด ({spoken_budgets}) และให้ say รวมทุกจังหวะยาว 150-{TARGET_SPOKEN} ตัวอักษร นับสระ วรรณยุกต์ ช่องว่าง และเครื่องหมายด้วย ถ้าเกินเพดานให้ย่อก่อนส่ง JSON พูดเป็นกันเองเหมือนเพื่อนแนะนำ
3. ข้อความบนจอและ badges แต่ละรายการไม่เกิน {MAX_LINE} ตัวอักษร ยกเว้นข้อความรีวิวที่ใช้ช่วงความยาวตามกฎของฉาก review ข้อความบนจอต้องตรงกับสิ่งที่ say พูดในจังหวะนั้น
4. ตัวเลขทุกตัวและคุณสมบัติทุกข้อต้องมีอยู่ในข้อมูลสินค้าด้านล่างเท่านั้น ห้ามแต่งเอง และต้องเขียนตัวเลขเหมือนในข้อมูลทุกหลัก ห้ามแปลงหน่วย เช่น ข้อมูลเขียน 6k ห้ามเขียนเป็น 6000
5. ห้ามอ้างสรรพคุณทางการแพทย์ ห้ามคำว่า การันตี ของแท้ 100% ดีที่สุด อันดับ 1
6. {clips_note}

ชื่อสินค้า: {title}

ข้อมูลจากหน้าสินค้า:
{page_text}"##,
        style_name = style.0,
        style_desc = style.1,
        clips_note = if has_clips {
            "มีคลิปวิดีโอสินค้าจริง ใช้ฉาก hook และ bigword ได้เต็มที่"
        } else {
            "ไม่มีคลิปวิดีโอ มีแต่รูปสินค้า ให้เน้นฉาก hero grid stamp count compare"
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn beat(scene: &str, say: &str) -> PlanBeat {
        PlanBeat { scene: scene.into(), say: say.into(), ..Default::default() }
    }

    fn good() -> Plan {
        let filler = "ผ้าเหนียวนุ่มเช็ดสะอาดไม่ขาดง่ายเลยครับ";
        let mut hook = beat("hook", filler);
        hook.text = vec!["ลูกผิวแพ้ง่าย".into(), "ใช้อะไรดี?".into()];
        let mut grid = beat("grid", filler);
        grid.badges = vec!["👶 หน้า".into(), "👄 ปาก".into(), "✋ มือ".into()];
        let mut count = beat("count", "ห่อใหญ่ 80 แผ่นคุ้มมากครับ");
        count.number = Some(80);
        Plan {
            product: Facts { brand: "DODOLOVE".into(), price: "199".into(), ..Default::default() },
            beats: vec![hook, beat("hero", filler), grid, count, beat("bigword", filler), beat("cta", filler)],
            ..Default::default()
        }
    }
    const SRC: &str = "ทิชชู่เปียก 80 แผ่น ราคา ฿199 ผ้าเหนียวนุ่ม";

    #[test]
    fn accepts_a_valid_plan() {
        assert_eq!(validate(&good(), SRC, &[]), Vec::<String>::new());
    }

    #[test]
    fn gives_the_model_a_spoken_budget_for_each_beat_count() {
        let instructions = prompt(STYLES[0], "ทิชชู่เปียก", SRC, false);
        for budget in ["6 จังหวะ: 35", "7 จังหวะ: 30", "8 จังหวะ: 26", "9 จังหวะ: 23"] {
            assert!(instructions.contains(budget), "ไม่มีเพดาน {budget}");
        }
    }

    #[test]
    fn tells_the_model_which_spoken_lines_to_shorten_on_overflow() {
        let mut p = good();
        for (beat, len) in p.beats.iter_mut().zip([40, 40, 40, 35, 40, 48]) {
            beat.say = "ก".repeat(len);
        }

        let errs = validate(&p, SRC, &[]).join("\n");
        assert!(errs.contains("แต่ได้ 243"), "{errs}");
        assert!(errs.contains("ไม่เกิน 35 ตัวอักษร"), "{errs}");
        assert!(errs.contains("จังหวะ 6 (48)"), "{errs}");
        assert!(!errs.contains("จังหวะ 4 (35)"), "{errs}");
    }

    #[test]
    fn rejects_invented_numbers() {
        let mut p = good();
        p.beats[3].number = Some(120);
        assert!(validate(&p, SRC, &[]).iter().any(|e| e.contains("120")));
    }

    #[test]
    fn rejects_structure_problems() {
        let mut p = good();
        p.beats.swap(0, 1);
        p.beats[4].scene = "count".into(); // now adjacent to the other count, and has no number
        let errs = validate(&p, SRC, &[]).join("\n");
        assert!(errs.contains("จังหวะแรกต้องเป็น hook"), "{errs}");
        assert!(errs.contains("ฉากซ้ำ"), "{errs}");
        assert!(errs.contains("ต้องมี number"), "{errs}");
    }

    #[test]
    fn rejects_banned_words_fake_reviews_and_missing_price() {
        let mut p = good();
        p.beats[1].say = "การันตีว่าดีครับ ผ้าเหนียวนุ่มเช็ดสะอาดไม่ขาดง่าย".into();
        p.beats[4] = beat("review", "คนซื้อไปบอกแบบนี้ครับ ผ้าเหนียวนุ่มมาก");
        p.beats[4].text = vec!["ดีมากค่ะ ซื้อซ้ำตลอด".into()];
        p.product.price.clear();
        p.beats[2] = beat("price", "ราคานี้คุ้มมากครับ ผ้าเหนียวนุ่มเช็ดสะอาด");
        let errs = validate(&p, SRC, &["การันตี".to_string()]).join("\n");
        assert!(errs.contains("คำต้องห้าม"), "{errs}");
        assert!(errs.contains("รีวิวจริง"), "{errs}");
        p.product.rating = Some(4.9);
        assert!(validate(&p, SRC, &[]).iter().any(|e| e.contains("คะแนน 4.9")));
        assert!(errs.contains("ไม่มีราคา"), "{errs}");
    }

    #[test]
    fn parses_json_wrapped_in_prose() {
        let p = parse("ได้เลยครับ\n```json\n{\"beats\":[{\"scene\":\"hook\",\"say\":\"a\"}]}\n```").unwrap();
        assert_eq!(p.beats[0].scene, "hook");
        assert!(parse("ไม่มีอะไร").is_err());
        let p = parse(r#"{"product":{"price":null,"rating":null},"beats":[{"scene":"cta","say":"a","text":null,"unit":null}]}"#).unwrap();
        assert_eq!(p.product.price, "");
        let p = parse(r#"{"product":{"price":179,"rating":4.9},"beats":[{"scene":"count","say":"a","number":80}]}"#).unwrap();
        assert_eq!((p.product.price.as_str(), p.product.rating, p.beats[0].number), ("179", Some(4.9), Some(80)));
        assert!(p.beats[0].text.is_empty());
    }

    #[test]
    fn beat_length_follows_voice() {
        assert_eq!(beat_frames(2.0, false), 66); // (2.0 + 0.18) * 30 = 65.4 -> 66
        assert_eq!(beat_frames(0.3, false), 36); // floor so a scene is never a blink
        assert_eq!(beat_frames(2.0, true), 87);
    }
}
