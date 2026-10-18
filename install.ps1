# XDS installer for Windows (experimental: XDS is developed on macOS). In PowerShell:
#   irm https://raw.githubusercontent.com/AvikArefin/xds/main/install.ps1 | iex
# Installs into %USERPROFILE%\xds (set XDS_DIR to change it). Safe to run again: it updates in place.
# Brings its own tools: uv (which brings Python) and a private Node.js inside the xds folder,
# so nothing else needs to be installed first and an existing Node is left alone.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RepoUrl = 'https://github.com/AvikArefin/xds'
$Dir = if ($env:XDS_DIR) { $env:XDS_DIR } else { Join-Path $HOME 'xds' }
$NodeMajor = 22

function Say($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Run { param([string]$exe, [Parameter(ValueFromRemainingArguments)]$rest)
  & $exe @rest
  if ($LASTEXITCODE -ne 0) { throw "failed: $exe $rest" } }

# 1. uv (and through it, Python 3.12)
if (-not (Has 'uv')) {
  Say 'Installing uv'
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  $env:Path = "$HOME\.local\bin;$env:Path"
  if (-not (Has 'uv')) { throw 'uv installed but not found; open a new PowerShell and run this again' }
}

# 2. The code: git if available, otherwise the zip from GitHub
if (Test-Path (Join-Path $Dir '.git')) {
  Say "Updating $Dir"
  Run git -C $Dir pull --ff-only
} elseif (Test-Path (Join-Path $Dir 'pyproject.toml')) {
  Say "Using the existing copy in $Dir"
} elseif (Has 'git') {
  Say "Downloading XDS into $Dir"
  Run git clone --depth 1 "$RepoUrl.git" $Dir
} else {
  Say "Downloading XDS into $Dir (no git found, using the zip)"
  $zip = Join-Path $env:TEMP 'xds-main.zip'
  $tmp = Join-Path $env:TEMP 'xds-main'
  Invoke-WebRequest "$RepoUrl/archive/refs/heads/main.zip" -OutFile $zip
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip $tmp
  Move-Item (Join-Path $tmp 'xds-main') $Dir
  Remove-Item $zip, $tmp -Recurse -Force
}
Set-Location $Dir

# 3. Node.js: the one on PATH if it is new enough, otherwise a private copy in .tools\node
$nodeOk = $false
if (Has 'node') { $nodeOk = [int](node -p "process.versions.node.split('.')[0]") -ge 20 }
if (-not $nodeOk) {
  $nodeDir = Join-Path $Dir '.tools\node'
  if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
    Say "Downloading Node.js $NodeMajor (private to XDS)"
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $base = "https://nodejs.org/dist/latest-v$NodeMajor.x"
    $file = ((Invoke-WebRequest "$base/SHASUMS256.txt" -UseBasicParsing).Content -split "`n" |
      ForEach-Object { ($_ -split '\s+')[1] } | Where-Object { $_ -match "^node-v.*-win-$arch\.zip$" } |
      Select-Object -First 1)
    if (-not $file) { throw "no Node.js download for win-$arch" }
    $zip = Join-Path $env:TEMP $file
    $tmp = Join-Path $env:TEMP 'xds-node'
    Invoke-WebRequest "$base/$file" -OutFile $zip
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive $zip $tmp
    if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
    New-Item -ItemType Directory -Force (Split-Path $nodeDir) | Out-Null
    Move-Item (Join-Path $tmp ($file -replace '\.zip$', '')) $nodeDir
    Remove-Item $zip, $tmp -Recurse -Force
  }
  $env:Path = "$nodeDir;$env:Path"
}

# 4. Install and build
Say 'Installing Python packages'
Run uv sync
Say "Installing the studio's packages"
Run npm install --no-fund --no-audit
Say 'Installing the renderer (Chromium)'
Run uv run playwright install chromium
Say 'Building the studio'
Run npm run build
Say 'Putting the xds command on your PATH'
Run uv tool install --editable . --force
uv tool update-shell *> $null

Write-Host @"

XDS is installed in $Dir.

Open a new PowerShell, then:
  xds init ~\xd-projects\first --name "First" --format instagram-portrait
  xds open ~\xd-projects\first

Optional: the iPhone and MacBook models are not included; see
$Dir\xds\library\models\AGENTS.md to set them up.
"@
