'use strict';

// The provider and installer stay in Electron's main process. The UI sees only
// these small, non-sensitive snapshots, never release URLs or executable paths.
function createUpdates({updater,enabled,version,onStatus=()=>{},canInstall=()=>true,install}) {
  let state=enabled?{status:'idle',version}:{status:'disabled',version,message:'Automatic updates need the installed Windows app. Use the Windows installer to enable them.'};
  let checking=null;
  const snapshot=()=>({...state});
  const publish=next=>{state=next;onStatus(snapshot());};
  const failed=()=>publish({status:'error',version,message:'Could not check or download the update. Check your connection and try again.'});
  if(enabled){
    updater.autoDownload=true;
    updater.autoInstallOnAppQuit=false;
    updater.allowPrerelease=false;
    updater.allowDowngrade=false;
    updater.on('checking-for-update',()=>publish({status:'checking',version}));
    updater.on('update-not-available',()=>publish({status:'current',version}));
    updater.on('update-available',info=>publish({status:'downloading',version:info.version,percent:0}));
    updater.on('download-progress',info=>{if(state.status==='downloading')publish({...state,percent:Number.isFinite(info.percent)?Math.max(0,Math.min(100,Math.round(info.percent))):0});});
    updater.on('update-downloaded',info=>publish({status:'ready',version:info.version,percent:100}));
    updater.on('error',failed);
  }
  return {
    snapshot,
    async check(){
      if(!enabled||['downloading','ready','installing'].includes(state.status))return snapshot();
      if(checking)return checking;
      publish({status:'checking',version});
      try {
        checking=Promise.resolve(updater.checkForUpdates()).then(result=>{
          // Downloading continues after the check resolves. Electron also emits
          // an error event, but its separate promise still needs a rejection handler.
          result?.downloadPromise?.catch(failed);
          return snapshot();
        }).catch(()=>{failed();return snapshot();});
        return await checking;
      } catch { failed();return snapshot(); }
      finally {checking=null;}
    },
    async install(){
      if(!enabled)throw Error('Use the Windows installer to enable automatic updates.');
      if(state.status!=='ready')throw Error('Wait until the update has downloaded and is ready.');
      if(!canInstall())throw Error('Review your unsaved library changes before restarting to update.');
      const ready=state;
      publish({...state,status:'installing'});
      try {await install();}catch(error){publish(ready);throw error;}
      return snapshot();
    },
  };
}
module.exports={createUpdates};
