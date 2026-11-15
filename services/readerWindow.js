const {execFile}=require('node:child_process');
const path=require('node:path');

function runWindowAction(args,timeout=15000) {
  return new Promise((resolve,reject)=>{
    execFile('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(__dirname,'readerWindow.ps1'),...args],
      {windowsHide:true,shell:false,timeout},(error,stdout)=>error?reject(error):resolve(stdout.trim()));
  });
}

async function activateReaderWindow() {
  if(process.platform!=='win32')return false;
  try {return await runWindowAction(['-Mode','Activate'])==='FOCUSED';}
  catch {return false;}
}

async function showLaunchMessage(message) {
  if(process.platform!=='win32')return;
  // A dialog remains visible until acknowledged. Arguments are passed directly, never as shell code.
  await runWindowAction(['-Mode','Notice','-Message',String(message).slice(0,1200)],0);
}

module.exports={activateReaderWindow,showLaunchMessage};
