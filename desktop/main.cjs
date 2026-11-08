'use strict';
const {app,BrowserWindow,ipcMain,safeStorage,dialog,session}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const {parseInstallLink,httpsUrl,sanitizeBook,parseBackup,trustedSender,LibrarySession}=require('./core.cjs');
let allowClose=false,closeRequested=false;let win,vault={},library,importDraft=null,epoch=0,authBusy=false;const requests=new Set();
const {createUpdates}=require('./updates.cjs');
const ACCENTS=new Set(['violet','blue','teal','orange','pink']);
let updates,desktopSettings={accent:'violet'};
function settingsPath(){return path.join(app.getPath('userData'),'desktop-settings.json');}
function saveAccent(value){if(!ACCENTS.has(value))throw Error('Choose an available accent.');const next={accent:value};fs.mkdirSync(path.dirname(settingsPath()),{recursive:true});fs.writeFileSync(settingsPath()+'.tmp',JSON.stringify(next));fs.renameSync(settingsPath()+'.tmp',settingsPath());desktopSettings=next;return value;}
const uiPath=path.join(__dirname,'ui','index.html');const uiURL=pathToFileURL(uiPath).href;
function vaultPath(){return path.join(app.getPath('userData'),'private-library.enc');}
function writeVault(){if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('Windows credential protection is unavailable. Please restart the app.');
 const file=vaultPath();fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',safeStorage.encryptString(JSON.stringify(vault)),{mode:0o600});fs.renameSync(file+'.tmp',file);}
function readVault(){if(!fs.existsSync(vaultPath()))return {};try {return JSON.parse(safeStorage.decryptString(fs.readFileSync(vaultPath())));}catch{throw Error('Your protected library could not be opened. Use the same Windows account that set up this app.');}}
function clearAccount(){epoch++;for(const c of requests)c.abort();requests.clear();library.clear();importDraft=null;delete vault.auth;delete vault.cache;writeVault();}
async function request(route,{method='GET',body,prefix=vault.prefix,token=vault.auth?.token}={}){
 if(!prefix)throw Error('Add your BusTAudio install link first.');
 const captured=epoch;const controller=new AbortController();requests.add(controller);const timer=setTimeout(()=>controller.abort(),50000);
 try{const response=await fetch(prefix+route,{method,redirect:'error',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:controller.signal});
  const data=await response.json();if(captured!==epoch)throw Error('Your account changed or you signed out.');
  if(!response.ok){if(response.status===401&&token){clearAccount();throw Object.assign(Error('Your session expired. Sign in again.'),{status:401});}
   const messages={400:'Check the information and try again.',401:'The username or password was not accepted.',403:'Access was not accepted. Check your install link or invitation.',404:'This server does not support personal libraries yet. Ask the person who runs it to update it.',409:'This book changed on another device.',429:'Too many attempts. Wait a few minutes and try again.',503:'Personal libraries are unavailable. Ask the server owner to enable persistent account storage.'};
   throw Object.assign(Error(messages[response.status]||'The server could not complete that request. Try again.'),{status:response.status,record:data.record});}
  return data;
 }catch(e){if(e.status||e.message?.startsWith('Your account'))throw e;throw Error('Cannot reach your library. Check your connection and try again.');}finally{clearTimeout(timer);requests.delete(controller);}
}
function state(){return {...library.snapshot(),configured:!!vault.prefix,server:vault.prefix?new URL(vault.prefix).host:null};}
function signedIn(){if(!vault.auth)throw Object.assign(Error('Sign in to open your library.'),{status:401});}
function id(value){if(typeof value!=='string'||!value||value.length>8192)throw Error('Choose a valid book.');return encodeURIComponent(value);}
async function authenticate(form,register){if(authBusy)throw Error('Sign-in is already in progress.');if(!form||typeof form.username!=='string'||typeof form.password!=='string'||form.username.length>100||form.password.length>256)throw Error('Enter your username and password.');
 authBusy=true;try{clearAccount();const current=epoch;const body={username:form.username.trim(),password:form.password};if(register)body.invite=String(form.invite||'').slice(0,512);
 const result=await request('/app/accounts/'+(register?'register':'login'),{method:'POST',body,token:null});if(current!==epoch)throw Error('Sign-in was cancelled.');
 vault.auth=result;library.bind(result.user);writeVault();try{await library.refresh();}catch{}return state();}finally{authBusy=false;}}
const handlers={
 desktopInfo:()=>({version:app.getVersion(),accent:desktopSettings.accent,updates:updates.snapshot()}),
 setAccent:value=>saveAccent(value),
 checkForUpdates:()=>updates.check(),
 installUpdate:()=>updates.install(),
 close:()=>{allowClose=true;win.close();return true;},
 state:()=>state(),
 configure:async value=>{if(vault.auth||authBusy)throw Error('Sign out before changing your server.');const prefix=parseInstallLink(value);await request('/health',{prefix,token:null});vault={prefix};epoch++;writeVault();return state();},
 login:form=>authenticate(form,false),register:form=>authenticate(form,true),
 logout:async()=>{const auth=vault.auth,prefix=vault.prefix;clearAccount();if(auth)try{await request('/app/accounts/logout',{method:'POST',body:{},prefix,token:auth.token});}catch{}return state();},
 refresh:async()=>{signedIn();await library.refresh();return state();},
 search:async({query,page=1}={})=>{signedIn();if(typeof query!=='string'||query.length>300||!Number.isInteger(page)||page<1||page>100)throw Error('Enter a shorter search.');const data=await request('/app/search?q='+encodeURIComponent(query.trim())+'&page='+page);return (data.results||[]).map(sanitizeBook);},
 details:async value=>{signedIn();const result=await request('/app/details/'+id(value));return {description:String(result.description||result.synopsis||'').slice(0,20000),genre:result.genre,year:result.year};},
 streams:async value=>{signedIn();const data=await request('/app/streams/'+id(value));return {ready:!!data.ready,streams:(data.streams||[]).filter(s=>httpsUrl(s.url)).map(s=>({url:httpsUrl(s.url),title:String(s.filename||s.title||'Part').slice(0,1000)}))};},
 save:async book=>{signedIn();const result=await library.save(book);return {...state(),conflict:!!result.conflict};},
 remove:async book=>{signedIn();await library.save(book,true);return state();},
 resolve:async({id:bookId,choice}={})=>{signedIn();id(bookId);await library.resolve(bookId,choice);return state();},
 previewImport:async()=>{signedIn();const current=epoch;const result=await dialog.showOpenDialog(win,{title:'Import a BusTAudio backup',properties:['openFile'],filters:[{name:'BusTAudio JSON backup',extensions:['json']}]});if(result.canceled)return null;if(current!==epoch)throw Error('Your account changed.');const file=result.filePaths[0];if(fs.statSync(file).size>10*1024*1024)throw Error('Choose a backup smaller than 10 MB.');importDraft=parseBackup(fs.readFileSync(file,'utf8'));return {count:importDraft.length,titles:importDraft.slice(0,8).map(b=>b.title)};},
 cancelImport:()=>{importDraft=null;return true;},
 confirmImport:async()=>{signedIn();if(!importDraft)throw Error('Choose a backup first.');const draft=importDraft;importDraft=null;const current=epoch;await library.refresh();let added=0,review=0;
 for(const book of draft){if(current!==epoch)throw Error('Your account changed.');if(library.records.has(book.id)){library.recoveries.set(book.id,{id:book.id,book,deleted:false,reason:'import'});library.stash();review++;}else{try{const result=await library.save(book);result.conflict?review++:added++;}catch(e){if(e.status===401||current!==epoch)throw e;review++;}}}return {...state(),imported:{added,review}};}
};
app.whenReady().then(async()=>{
 try{try{const settings=JSON.parse(fs.readFileSync(settingsPath(),'utf8'));if(ACCENTS.has(settings.accent))desktopSettings={accent:settings.accent};}catch{/* Use the default appearance when no settings exist. */}
 vault=readVault();library=new LibrarySession({request,persist:cache=>{vault.cache=cache;writeVault();}});if(vault.auth&&vault.cache?.user?.id===vault.auth.user.id)library.bind(vault.auth.user,vault.cache.records,vault.cache.recoveries);else if(vault.auth)library.bind(vault.auth.user);
 session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));session.defaultSession.setPermissionCheckHandler(()=>false);
 win=new BrowserWindow({width:1280,height:860,minWidth:920,minHeight:660,backgroundColor:'#15101c',title:'BusTAudio',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,webviewTag:false,spellcheck:false}});
 const installed=app.isPackaged&&process.platform==='win32'&&fs.existsSync(path.join(process.resourcesPath,'installed-release'));
 const autoUpdater=installed?require('electron-updater').autoUpdater:null;
 updates=createUpdates({updater:autoUpdater,enabled:installed,version:app.getVersion(),onStatus:value=>{if(value.status==='error')allowClose=false;if(win&&!win.isDestroyed())win.webContents.send('bustaudio:update-status',value);},canInstall:()=>!authBusy&&library.recoveries.size===0,install:()=>{allowClose=true;autoUpdater.quitAndInstall(false,true);}});
 win.on('close',event=>{if(allowClose)return;event.preventDefault();if(closeRequested)return;closeRequested=true;win.webContents.send('bustaudio:before-close');setTimeout(()=>{allowClose=true;win.close();},12000).unref();});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.on('will-attach-webview',e=>e.preventDefault());
 for(const [name,handler]of Object.entries(handlers))ipcMain.handle('bustaudio:'+name,async(event,payload)=>{if(!trustedSender(event,win.webContents,uiURL))return {ok:false,error:'This request is not allowed.'};try{return {ok:true,value:await handler(payload)};}catch(e){return {ok:false,error:e.message||'Something went wrong.',status:e.status||null};}});
 await win.loadFile(uiPath);
 if(installed){setTimeout(()=>updates.check(),15000).unref();setInterval(()=>updates.check(),6*60*60*1000).unref();}
 }catch(e){dialog.showErrorBox('BusTAudio could not start',e.message);app.quit();}
});
app.on('window-all-closed',()=>app.quit());
