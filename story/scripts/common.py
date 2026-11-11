"""Shared helpers for the story scripts. Every script runs with the job's story folder as the working directory."""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def dump(path, data) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def need(program: str) -> str:
    found = shutil.which(program)
    if not found:
        sys.exit(f"{program} not found on PATH")
    return found


def run(cmd) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        sys.exit(f"{Path(str(cmd[0])).name} failed: {r.stderr[-800:]}")


def duration(file) -> float:
    out = subprocess.run(
        [need("ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(file)],
        capture_output=True, text=True,
    ).stdout
    return float(out.strip())


def read_script(path="script.md"):
    """Rows of the `| # | VO | Subtitle |` table -> [{"th": ..., "en": ...}]"""
    rows = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\|\s*(\d+)\s*\|(.*)\|(.*)\|\s*$", line)
        if m:
            rows.append({"th": m.group(2).strip(), "en": m.group(3).strip()})
    if not rows:
        sys.exit(f"{path} has no | # | VO | Subtitle | table")
    return rows


def resolve_time(value) -> float:
    """Seconds, or a line ref through src/lines.json: L5 (start), L5e (end), L5+0.4, L5-0.1, END (just after the last word)."""
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    lines = load("src/lines.json")["lines"]
    if text.upper().startswith("END"):
        base, rest = lines[-1]["end"] + 0.4, text[3:]
    else:
        m = re.match(r"^L(\d+)(e?)(.*)$", text)
        if not m:
            return float(text)
        n = int(m.group(1))
        if not 1 <= n <= len(lines):
            sys.exit(f"{text}: there is no line {n}")
        base, rest = lines[n - 1]["end" if m.group(2) else "t"], m.group(3)
    return max(0.0, base + (float(rest) if rest.strip() else 0.0))
