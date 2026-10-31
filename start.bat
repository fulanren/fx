@echo off
chcp 65001 >nul
where python >nul 2>nul
if %errorlevel%==0 (
  start http://localhost:8080
  python -m http.server 8080
) else (
  echo 未检测到 Python。直接双击 index.html 可能导致数据无法持久化。
  pause
)