# Serve foort-gpu/ locally (no build step). Usage: powershell -File dev\serve.ps1 [-Port 8765]
param([int]$Port = 8765)
Set-Location (Join-Path $PSScriptRoot '..')
Write-Host "FOORT-GPU at http://127.0.0.1:$Port/  (benchmark: http://127.0.0.1:$Port/bench/)"
python -m http.server $Port --bind 127.0.0.1
