@echo off
rem Restart the gradfinder dev server. The watchdog in the Startup folder (gradfinder.vbs) relaunches it within ~10 s.
powershell -NoProfile -Command "$id = (Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 0 } | Select-Object -First 1 -ExpandProperty OwningProcess); if (-not $id) { $id = netstat -ano | Select-String ':3000 ' | ForEach-Object { ($_ -split '\s+')[-1] } | Where-Object { $_ -gt 0 } | Select-Object -First 1 }; if ($id) { Stop-Process -Id $id -Force; 'Stopped PID ' + $id + '. The watchdog restarts it in about 10 seconds; the first page load is slow.' } else { 'Nothing found on :3000 (the watchdog starts it within ~10 seconds).' }"
timeout /t 8 >nul
