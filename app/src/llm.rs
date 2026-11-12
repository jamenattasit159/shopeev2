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
        "gemini-cli" => cli("gemini", &["-p", "ตอบตามคำสั่งใน stdin"], prompt, None, 240).await,
        "claude-cli" => {
            let mut args = vec!["-p"];
            args.extend(claude_choice(cfg));
            cli(&claude_bin(), &args, prompt, None, 240).await
        }
        "gpt-cli" => cli("codex", &["exec", "--skip-git-repo-check", "-s", "read-only", "-"], prompt, None, 240).await,
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

/// Claude Code without a screen, working in `cwd` and allowed to READ files there only (it looks at the product photos).
/// Its reply comes back as text; this app writes the files.
pub async fn claude_code(cfg: &Config, prompt: &str, cwd: &std::path::Path) -> Result<String> {
    let mut args = vec!["-p", "--tools", "Read", "--allowedTools", "Read"];
    args.extend(claude_choice(cfg));
    cli(&claude_bin(), &args, prompt, Some(cwd), 480).await
}

pub const EFFORTS: [&str; 6] = ["", "low", "medium", "high", "xhigh", "max"];
/// --model / --effort from the settings (validated when saved)
fn claude_choice(cfg: &Config) -> Vec<&str> {
    let mut a = Vec::new();
    if !cfg.models.claude_code.is_empty() {
        a.extend(["--model", cfg.models.claude_code.as_str()]);
    }
    if !cfg.models.effort.is_empty() {
        a.extend(["--effort", cfg.models.effort.as_str()]);
    }
    a
}

/// The Claude Code CLI. Its native installer puts it in ~/.local/bin, which is often missing from the PATH this app gets.
pub fn claude_bin() -> String {
    let exe: &[&str] = if cfg!(windows) { &["claude.exe", "claude.cmd"] } else { &["claude"] };
    let on_path = std::env::var_os("PATH").map_or(false, |p| std::env::split_paths(&p).any(|d| exe.iter().any(|e| d.join(e).is_file())));
    if on_path {
        return "claude".into();
    }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(std::path::PathBuf::from);
    home.map(|h| h.join(".local").join("bin").join(exe[0])).filter(|p| p.is_file()).map_or_else(|| "claude".into(), |p| p.to_string_lossy().into_owned())
}

/// Installed and logged in: "--version" alone passes even when the login has expired.
pub async fn has_claude_code() -> bool {
    cli(&claude_bin(), &["-p"], "reply OK", None, 60).await.is_ok()
}

async fn cli(program: &str, args: &[&str], prompt: &str, cwd: Option<&std::path::Path>, secs: u64) -> Result<String> {
    // npm-installed CLIs are .cmd shims on Windows; they only start through cmd.
    // a full path to an .exe starts directly; bare names may be .cmd shims that need cmd
    let mut cmd = if cfg!(windows) && !program.ends_with(".exe") {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/C").arg(program);
        c
    } else {
        tokio::process::Command::new(program)
    };
    let mut child = cmd
        .args(args)
        .current_dir(cwd.map(std::path::Path::to_path_buf).unwrap_or_else(std::env::temp_dir)) // by default keep the agent CLIs away from project files
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("เรียกโปรแกรม {program} ไม่ได้ ติดตั้งและล็อกอินแล้วหรือยัง"))?;
    let mut stdin = child.stdin.take().expect("piped");
    stdin.write_all(prompt.as_bytes()).await?;
    drop(stdin);
    let out = tokio::time::timeout(std::time::Duration::from_secs(secs), child.wait_with_output())
        .await
        .map_err(|_| anyhow!("{program} ไม่ตอบภายใน {secs} วินาที"))??;
    if !out.status.success() {
        // some CLIs explain themselves on stdout (claude: "Failed to authenticate ...")
        let err = [&out.stderr, &out.stdout].iter().map(|b| String::from_utf8_lossy(b).trim().to_string()).find(|t| !t.is_empty()).unwrap_or_default();
        bail!("{program} ล้มเหลว: {}", err.chars().take(300).collect::<String>());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}
