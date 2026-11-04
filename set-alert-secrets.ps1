# Copies the alert settings from .env into the GitHub repo's encrypted Secrets,
# so the cloud daily scan can send Gmail / WhatsApp alerts.
# Run after filling in .env:   powershell -ExecutionPolicy Bypass -File .\set-alert-secrets.ps1
# Values are sent straight to GitHub (encrypted); they are never printed or committed.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$names = 'ALERT_GMAIL_USER', 'ALERT_GMAIL_APP_PASSWORD', 'ALERT_EMAIL_TO', 'ALERT_WHATSAPP_PHONE', 'ALERT_CALLMEBOT_APIKEY'
$envMap = @{}
Get-Content .env | Where-Object { $_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$' } | ForEach-Object {
  $null = $_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$'; $envMap[$Matches[1]] = $Matches[2].Trim()
}
foreach ($n in $names) {
  $v = $envMap[$n]
  if ([string]::IsNullOrWhiteSpace($v)) { Write-Host "skip  $n (empty in .env)"; continue }
  $v | gh secret set $n --body - | Out-Null
  Write-Host "set   $n"
}
Write-Host "`nDone. Test from GitHub: Actions -> 'Daily job scan' -> Run workflow."
