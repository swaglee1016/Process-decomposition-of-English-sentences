param([Parameter(Mandatory=$true)][string]$BuildDirectory,[Parameter(Mandatory=$true)][string]$InstallRoot,[ValidateSet('prepare','resume','complete','ui','extract-node','launch-conflict')][string]$Mode='prepare')
$ErrorActionPreference='Stop'
$build=[IO.Path]::GetFullPath($BuildDirectory)
$root=[IO.Path]::GetFullPath($InstallRoot)
$exe=Join-Path $build 'SentenceProcess-Setup.exe'
$runner=Join-Path $build 'VerifyInstall.exe'
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:exe /platform:x64 "/win32manifest:$PSScriptRoot\app.manifest" "/out:$runner" "/r:$exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'VerifyInstall.cs')
if($LASTEXITCODE -ne 0){throw 'Verification runner compilation failed'}
& $runner $Mode $root (Join-Path $build 'installer-welcome.png')
if($LASTEXITCODE -ne 0){throw 'Installation verification failed'}
