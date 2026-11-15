param([string]$BuildDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (-not $BuildDirectory) { $BuildDirectory = Join-Path $projectRoot ('outputs\installer-build-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
$BuildDirectory = [IO.Path]::GetFullPath($BuildDirectory)
$outputRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'outputs')) + [IO.Path]::DirectorySeparatorChar
if (-not $BuildDirectory.StartsWith($outputRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Build directory must be inside project outputs.' }
if (Test-Path -LiteralPath $BuildDirectory) { throw 'Use a fresh build directory; existing files are preserved.' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler was not found.' }
$stage = Join-Path $BuildDirectory 'app'
New-Item -ItemType Directory -Path $stage -Force | Out-Null
foreach ($name in @('package.json','package-lock.json','server.js','launcher.js','README.md','CHANGELOG.md')) { Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $stage }
foreach ($name in @('public','services')) { Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination $stage -Recurse }
New-Item -ItemType Directory -Path (Join-Path $stage 'docs') | Out-Null
foreach ($name in @('USER-GUIDE.md','INSTALL.md')) { if (Test-Path -LiteralPath (Join-Path $projectRoot ('docs\' + $name))) { Copy-Item -LiteralPath (Join-Path $projectRoot ('docs\' + $name)) -Destination (Join-Path $stage 'docs') } }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'THIRD-PARTY-NOTICES.md') -Destination $stage
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\images') -Destination (Join-Path $stage 'docs') -Recurse
Push-Location $stage
try {
    & npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency preparation failed.' }
} finally { Pop-Location }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$payload = Join-Path $BuildDirectory 'app.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $payload, [IO.Compression.CompressionLevel]::Optimal, $false)
$exe = Join-Path $BuildDirectory 'SentenceProcess-Setup.exe'
$references = @('/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll','/r:System.Security.dll')
& $compiler /nologo /target:winexe /platform:x64 /optimize+ "/out:$exe" "/win32manifest:$PSScriptRoot\app.manifest" "/resource:$payload,app.zip" "/resource:$PSScriptRoot\components.json,manifest.json" @references "$PSScriptRoot\InstallerCore.cs" "$PSScriptRoot\SetupForm.cs"
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
$hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  SentenceProcess-Setup.exe" | Set-Content -LiteralPath (Join-Path $BuildDirectory 'SHA256SUMS.txt') -Encoding ascii
[pscustomobject]@{Exe=$exe; SHA256=$hash; Bytes=(Get-Item -LiteralPath $exe).Length} | ConvertTo-Json | Set-Content (Join-Path $BuildDirectory 'build.json')
Get-Content (Join-Path $BuildDirectory 'build.json')
