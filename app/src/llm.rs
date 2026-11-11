//! Text-in, text-out access to the "director" model.
//! Six routes: three pay-per-use APIs and three subscription CLIs already logged in on this machine.
use crate::Config;
use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;

pub const PROVIDERS: [&str; 6] = ["gemini-api", "claude-api", "gpt-api", "gemini-cli", "claude-cli", "gpt-cli"];

pub async fn complete(provider: &str, cfg: &Config, prompt: &str) -> Result<String> {
    match provider {
        "gemini-api" => {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
                cfg.models.gemini
            );
            let body = json!({"contents": [{"role": "user", "parts": [{"text": prompt}]}]});
            let v = post(&url, &[("x-goog-api-key", key(&cfg.keys.gemini, "Gemini")?)], body).await?;
            text_at(&v, "/candidates/0/content/parts/0/text")
        }
        "claude-api" => {
            let body = json!({"model": cfg.models.claude, "max_tokens": 4000, "messages": [{"role": "user", "content": prompt}]});
            let headers = [("x-api-key", key(&cfg.keys.claude, "Claude")?), ("anthropic-version", "2023-06-01".to_string())];
            let v = post("https://api.anthropic.com/v1/messages", &headers, body).await?;
            text_at(&v, "/content/0/text")
        }
        "gpt-api" => {
            if cfg.models.gpt.trim().is_empty() {
                bail!("ยังไม่ได้ตั้งชื่อโมเดล GPT ในหน้าตั้งค่า");
            }
            let body = json!({"model": cfg.models.gpt, "messages": [{"role": "user", "content": prompt}]});
            let auth = format!("Bearer {}", key(&cfg.keys.gpt, "GPT")?);
            let v = post("https://api.openai.com/v1/chat/completions", &[("authorization", auth)], body).await?;
            text_at(&v, "/choices/0/message/content")
        }
        // The CLIs read the prompt from stdin, so quoting and length limits never bite.
        "gemini-cli" => cli("gemini", &["-p", "ตอบตามคำสั่งใน stdin"], prompt).await,
        "claude-cli" => cli("claude", &["-p"], prompt).await,
        "gpt-cli" => cli("codex", &["exec", "--skip-git-repo-check", "-s", "read-only", "-"], prompt).await,
        other => bail!("ไม่รู้จักผู้ให้บริการ {other}"),
    }
}

fn key(k: &str, name: &str) -> Result<String> {
    if k.trim().is_empty() {
        bail!("ยังไม่ได้ใส่ API key ของ {name}");
    }
    Ok(k.trim().to_string())
}

async fn post(url: &str, headers: &[(&str, String)], body: Value) -> Result<Value> {
    let mut req = reqwest::Client::new().post(url).timeout(std::time::Duration::from_secs(120)).json(&body);
    for (k, v) in headers {
        req = req.header(*k, v);
    }
    let res = req.send().await.context("เชื่อมต่อผู้ให้บริการ AI ไม่ได้")?;
    let status = res.status();
    let text = res.text().await?;
    if !status.is_success() {
        bail!("ผู้ให้บริการตอบ {status}: {}", text.chars().take(300).collect::<String>());
    }
    Ok(serde_json::from_str(&text)?)
}

fn text_at(v: &Value, pointer: &str) -> Result<String> {
    v.pointer(pointer)
        .and_then(Value::as_str)
        .map(String::from)
        .ok_or_else(|| anyhow!("คำตอบจากผู้ให้บริการไม่มีข้อความ"))
}

async fn cli(program: &str, args: &[&str], prompt: &str) -> Result<String> {
    // npm-installed CLIs are .cmd shims on Windows; they only start through cmd.
    let mut cmd = if cfg!(windows) {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/C").arg(program);
        c
    } else {
        tokio::process::Command::new(program)
    };
    let mut child = cmd
        .args(args)
        .current_dir(std::env::temp_dir()) // keep the agent CLIs away from project files
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("เรียกโปรแกรม {program} ไม่ได้ ติดตั้งและล็อกอินแล้วหรือยัง"))?;
    let mut stdin = child.stdin.take().expect("piped");
    stdin.write_all(prompt.as_bytes()).await?;
    drop(stdin);
    let out = tokio::time::timeout(std::time::Duration::from_secs(240), child.wait_with_output())
        .await
        .map_err(|_| anyhow!("{program} ไม่ตอบภายใน 4 นาที"))??;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        bail!("{program} ล้มเหลว: {}", err.chars().take(300).collect::<String>());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}
