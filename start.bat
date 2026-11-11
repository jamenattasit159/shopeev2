@echo off
rem Starts Shopee Clip V2 and opens the UI. Builds the app on first run.
cd /d "%~dp0"
if not exist app\target\release\shopee-clip.exe (
  echo Building the app for the first time...
  cargo build --release --manifest-path app\Cargo.toml || (pause & exit /b 1)
)
start "" http://127.0.0.1:4317
app\target\release\shopee-clip.exe
pause
