$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$launcherPath = Join-Path $projectDirectory 'launcher.js'
if (-not (Test-Path -LiteralPath $launcherPath)) { throw 'Application launcher was not found.' }
$shortcutName = [string]::Concat([char]0x82F1,[char]0x8BED,[char]0x9605,[char]0x8BFB,[char]0x4E0E,[char]0x53E5,[char]0x5B50,[char]0x5206,[char]0x6790)
$shell = New-Object -ComObject WScript.Shell
$shortcutPaths = @()
foreach ($destination in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))) {
    if (-not $destination -or -not (Test-Path -LiteralPath $destination)) { throw 'Windows shortcut destination was not found.' }
    $shortcutPath = Join-Path $destination ($shortcutName + '.lnk')
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if ((Test-Path -LiteralPath $shortcutPath) -and ($shortcut.Arguments -ne ('"' + $launcherPath + '"') -or $shortcut.TargetPath -ne $nodeExecutable)) {
        throw ('An unrelated shortcut already exists: ' + $shortcutPath)
    }
    $shortcut.TargetPath = $nodeExecutable
    $shortcut.Arguments = '"' + $launcherPath + '"'
    $shortcut.WorkingDirectory = $projectDirectory
    $shortcut.Description = 'Open the English reading and sentence analysis application'
    $shortcut.IconLocation = $nodeExecutable + ',0'
    $shortcut.WindowStyle = 7
    $shortcut.Save()
    $check = $shell.CreateShortcut($shortcutPath)
    if ($check.TargetPath -ne $nodeExecutable -or $check.WorkingDirectory -ne $projectDirectory -or $check.Arguments -ne $shortcut.Arguments) {
        throw ('Shortcut validation failed: ' + $shortcutPath)
    }
    $shortcutPaths += $shortcutPath
}
$shortcutPaths | ForEach-Object { Write-Output ('Created and verified: ' + $_) }
