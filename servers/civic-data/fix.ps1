# fix.ps1 - one-shot repair for the civic-data MCP server.
# Run in PowerShell:  cd C:\projects\FleetMcpServers\servers\civic-data; .\fix.ps1
# 1) creates the 027 public views in OhioCivicData (rerunnable)
# 2) runs dab validate against the live database
# 3) writes the civic-data entry into Claude Desktop's config
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$cfg  = Join-Path $here 'dab-config.json'

Write-Host "`n[1/4] Locating dab.exe" -ForegroundColor Cyan
$dab = Join-Path $env:USERPROFILE '.dotnet\tools\dab.exe'
if (-not (Test-Path $dab)) { $dab = (Get-Command dab -ErrorAction SilentlyContinue).Source }
if (-not $dab) { throw "dab.exe not found. Run: dotnet tool install microsoft.dataapibuilder -g" }
Write-Host "      $dab"
& $dab --version

Write-Host "`n[2/4] Creating civic.v_*_public views (027_mcp_public_views.sql)" -ForegroundColor Cyan
$sql027 = 'C:\projects\OhioCivicData\sql\027_mcp_public_views.sql'
sqlcmd -S localhost -E -b -d OhioCivicData -i $sql027
if ($LASTEXITCODE -ne 0) { throw "027 script failed (exit $LASTEXITCODE)" }
sqlcmd -S localhost -E -b -d OhioCivicData -h -1 -W -Q "SET NOCOUNT ON; SELECT name FROM sys.views WHERE schema_id = SCHEMA_ID('civic') ORDER BY name;"

Write-Host "`n[3/4] dab validate" -ForegroundColor Cyan
$env:SQL_CONNECTION_STRING = 'Server=localhost;Database=OhioCivicData;Integrated Security=True;TrustServerCertificate=True;Encrypt=False'
& $dab validate --config $cfg
if ($LASTEXITCODE -ne 0) { throw "dab validate failed (exit $LASTEXITCODE) - paste the output above into the chat" }

Write-Host "`n[4/4] Writing civic-data into Claude Desktop config" -ForegroundColor Cyan
$desktopCfg = Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'
$entry = [ordered]@{
  command = $dab
  args    = @('start', '--mcp-stdio', 'role:reader', '--config', $cfg, '--LogLevel', 'error')
  env     = [ordered]@{ SQL_CONNECTION_STRING = $env:SQL_CONNECTION_STRING }
}
if (Test-Path $desktopCfg) {
  Copy-Item $desktopCfg "$desktopCfg.bak" -Force
  $json = Get-Content $desktopCfg -Raw | ConvertFrom-Json
} else {
  New-Item -ItemType Directory -Force (Split-Path $desktopCfg) | Out-Null
  $json = [pscustomobject]@{}
}
if (-not $json.PSObject.Properties['mcpServers']) { $json | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{}) }
if ($json.mcpServers.PSObject.Properties['civic-data']) { $json.mcpServers.PSObject.Properties.Remove('civic-data') }
$json.mcpServers | Add-Member -NotePropertyName 'civic-data' -NotePropertyValue ([pscustomobject]$entry)
$json | ConvertTo-Json -Depth 10 | Set-Content $desktopCfg -Encoding UTF8
Write-Host "      wrote $desktopCfg (backup: .bak)"

Write-Host "`nDONE. Fully quit Claude Desktop (system tray > Quit), relaunch, then ask:" -ForegroundColor Green
Write-Host '      "What entities does civic-data have?"'
