# Arranca el runner self-hosted de GitHub Actions (instalado en C:\actions-runner) en una ventana minimizada.
# Uso: powershell -File scripts/start-runner.ps1   (para detenerlo: cerrar la ventana "Runner.Listener")
# Git Bash primero: si no, "shell: bash" de los workflows toma el bash de WSL (sin distro instalada) y falla.
# Después el PATH completo del usuario y del sistema, que incluye terraform.
$env:Path = 'C:\Program Files\Git\bin;' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
if (Get-Process Runner.Listener -ErrorAction SilentlyContinue) { 'El runner ya está corriendo'; return }
Start-Process -FilePath 'C:\actions-runner\run.cmd' -WorkingDirectory 'C:\actions-runner' -WindowStyle Minimized
'Runner iniciado'
