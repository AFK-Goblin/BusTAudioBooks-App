'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const call=(method,payload)=>ipcRenderer.invoke('bustaudio:'+method,payload).then(result=>{if(!result.ok){const error=new Error(result.error);error.status=result.status;throw error;}return result.value;});
contextBridge.exposeInMainWorld('books',Object.freeze({
 close:()=>call('close'),onBeforeClose:callback=>{if(typeof callback==='function')ipcRenderer.on('bustaudio:before-close',()=>callback());},
 state:()=>call('state'),configure:link=>call('configure',link),login:form=>call('login',form),register:form=>call('register',form),logout:()=>call('logout'),
 refresh:()=>call('refresh'),search:(query,page=1)=>call('search',{query,page}),details:id=>call('details',id),streams:id=>call('streams',id),
 save:book=>call('save',book),remove:book=>call('remove',book),resolve:(id,choice)=>call('resolve',{id,choice}),
 previewImport:()=>call('previewImport'),confirmImport:()=>call('confirmImport'),cancelImport:()=>call('cancelImport')
}));
