@echo off
cd /d "%~dp0"
"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /optimize /codepage:65001 /target:winexe /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Net.Http.dll /out:..\ShopeeClip.exe ShopeeClip.cs LauncherArtwork.cs
exit /b %errorlevel%
