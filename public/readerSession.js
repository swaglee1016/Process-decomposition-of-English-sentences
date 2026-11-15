(function(root){
  'use strict';
  function mount({capture,restore,status}){
    const headers={'Content-Type':'application/json','X-Reader-Client':'workspace'};
    const clientId=root.crypto.randomUUID();
    let revision=0,ready=false,saving=null,saveAgain=false,last='',instanceId='',offline=false,conflict=false,reloadPending=false,booting=null,switching=false;
    async function json(url,options={}){
      const response=await fetch(url,{...options,headers:{...headers,...options.headers},cache:'no-store'});
      const data=await response.json();
      if(!response.ok)throw Object.assign(new Error(data.error||'阅读进度保存失败'),{status:response.status});
      return data;
    }
    async function flush(){
      if(!ready||conflict||switching)return false;
      if(saving){saveAgain=true;return saving;}
      saving=(async()=>{
        do{
          saveAgain=false;
          const state=capture(),serialized=JSON.stringify(state);
          if(serialized===last)return true;
          try{
            const result=await json('/api/workspace',{method:'PUT',body:JSON.stringify({state,revision})});
            revision=result.revision;last=serialized;
            status.textContent='阅读进度已保存';
          }catch(error){
            if(error.status===409){
              let saved;
              try{saved=await json('/api/workspace');}
              catch{status.textContent='阅读进度暂未保存，连接恢复后自动重试。';return false;}
              if(JSON.stringify(saved.state)===serialized||JSON.stringify(saved.state)===last){
                revision=saved.revision;saveAgain=true;continue;
              }
              conflict=true;status.textContent='另一个阅读页面保存了新进度，请刷新本页恢复。';
            }else status.textContent='阅读进度暂未保存，连接恢复后自动重试。';
            return false;
          }
        }while(saveAgain&&!conflict);
        return true;
      })().finally(()=>{saving=null;});
      return saving;
    }
    async function activate(loadState){
      if(!await flush())throw new Error('当前进度尚未保存，请恢复连接后再切换。');
      switching=true;
      try{
        const switchRevision=revision;
        const state=await loadState();
        if(!state){switching=false;return false;}
        const result=await json('/api/workspace',{method:'PUT',body:JSON.stringify({state,revision:switchRevision})});
        revision=result.revision;last=JSON.stringify(state);
        root.location.reload();
        return true;
      }catch(error){
        switching=false;throw error;
      }
    }
    async function heartbeat(){
      try{
        if(!ready){await bootstrap();if(!ready)return;}
        const info=await json('/api/reader/presence',{method:'POST',body:JSON.stringify({clientId})});
        const restarted=instanceId&&info.instanceId!==instanceId;
        instanceId=info.instanceId;
        if(restarted)reloadPending=true;
        if(reloadPending&&ready&&!switching){
          // Persist the still-open tab's state before loading the new scripts.
          await flush();
          if(!conflict&&!saving&&last===JSON.stringify(capture())){root.location.reload();return;}
        }
        if(offline){offline=false;status.textContent='已重新连接阅读器';}
      }catch{offline=true;status.textContent='后台暂时离线，页面保留；恢复后会自动连接。';}
    }
    async function bootstrap(){
      if(booting)return booting;
      booting=(async()=>{
        try{
          const saved=await json('/api/workspace');
          revision=saved.revision;
          if(saved.state){
            await restore(saved.state);
            last=JSON.stringify(saved.state.readingLabel?capture():saved.state);
          }
          ready=true;
        }catch(error){status.textContent='正在等待阅读器恢复，已保存的书籍与结果仍在本地。';}
      })();
      try{await booting;}finally{booting=null;}
    }
    const initialized=bootstrap().then(()=>heartbeat());
    let destroyed=false;
    const connectionAbort=new AbortController();
    async function keepConnection(){
      while(!destroyed){
        try{
          const response=await fetch('/api/reader/connection?clientId='+encodeURIComponent(clientId),{headers,cache:'no-store',signal:connectionAbort.signal});
          if(!response.ok)throw Error('Connection unavailable');
          const reader=response.body.getReader();
          while(!(await reader.read()).done&&!destroyed){}
          reader.releaseLock();
        }catch{}
        if(!destroyed)await new Promise(resolve=>root.setTimeout(resolve,1000));
      }
    }
    void keepConnection();
    const timer=root.setInterval(()=>{void heartbeat();void flush();},2000);
    root.addEventListener('pagehide',()=>{
      if(!ready||conflict||switching)return;
      const state=capture();
      if(JSON.stringify(state)===last)return;
      void fetch('/api/workspace',{method:'PUT',headers,body:JSON.stringify({state,revision}),keepalive:true}).catch(()=>{});
    });
    return {flush,activate,initialized,destroy:()=>{destroyed=true;connectionAbort.abort();root.clearInterval(timer);}};
  }
  root.ReaderSession={mount};
})(window);
