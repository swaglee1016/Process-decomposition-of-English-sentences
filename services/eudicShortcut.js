const {spawn:spawnProcess}=require('node:child_process');
const {normalizeWord}=require('../public/vocabularyShared');
// Fixed script: the selected word is data on stdin, never executable shell text.
const script=`$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ReaderForeground { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process); }'
$readerWindow=[ReaderForeground]::GetForegroundWindow()
[uint32]$readerProcessId=0
[void][ReaderForeground]::GetWindowThreadProcessId($readerWindow,[ref]$readerProcessId)
$readerProcess=Get-Process -Id $readerProcessId
if($readerProcess.ProcessName -notin @('chrome','msedge','firefox','brave','opera','vivaldi')){exit 21}
$encodedWord=[Console]::In.ReadToEnd().Trim()
$selectedWord=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedWord))
try {[System.Windows.Forms.Clipboard]::SetText($selectedWord)} catch {exit 24}
[System.Windows.Forms.SendKeys]::SendWait('^c')
Start-Sleep -Milliseconds 80
if([ReaderForeground]::GetForegroundWindow() -ne $readerWindow){exit 22}
try {$copiedWord=[System.Windows.Forms.Clipboard]::GetText()} catch {exit 24}
if($copiedWord -cne $selectedWord){exit 23}
[System.Windows.Forms.SendKeys]::SendWait('^c')`;
async function sendEudicShortcut(value,{platform=process.platform,spawn=spawnProcess}={}){
 const word=normalizeWord(value);if(platform!=='win32')throw Error('Windows keyboard integration is unavailable');
 return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,shell:false,stdio:['pipe','ignore','ignore']});
 const timer=setTimeout(()=>{child.kill();reject(Object.assign(Error('Keyboard integration timed out'),{code:'EUDIC_TIMEOUT'}));},6000);
 child.once('error',()=>{clearTimeout(timer);reject(Object.assign(Error('Keyboard integration failed'),{code:'EUDIC_HELPER_FAILED'}));});child.stdin.on?.('error',()=>{});
 child.once('close',code=>{clearTimeout(timer);code===0?resolve({sent:true}):reject(Object.assign(Error('Keyboard integration failed'),{code:({21:'EUDIC_NOT_FOREGROUND',22:'EUDIC_WINDOW_CHANGED',23:'EUDIC_COPY_MISMATCH',24:'EUDIC_CLIPBOARD_BUSY'})[code]||'EUDIC_HELPER_FAILED'}));});child.stdin.end(Buffer.from(word,'utf8').toString('base64'));
 });
}
module.exports={sendEudicShortcut};
