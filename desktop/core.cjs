'use strict';
function parseInstallLink(value) {
 const text=String(value||'').trim().replace(/^stremio:/i,'https:');
 if(!/^https:\/\/[^/?#]+\/[A-Za-z0-9_-]+(?:\/manifest\.json)?\/?$/.test(text)) throw Error('Paste a complete secure BusTAudio install link.');
 const url=new URL(text);if(url.username||url.password||url.protocol!=='https:')throw Error('Use a secure install link without a username or password.');
 return url.origin+url.pathname.replace(/\/manifest\.json\/?$/,'').replace(/\/$/,'');
}
function httpsUrl(value){try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function text(value,max=500){return typeof value==='string'?value.slice(0,max):'';}
function number(value,max=1e12){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>max)throw Error('Invalid listening information.');return value;}
function sanitizeBook(input){
 if(!input||typeof input.id!=='string'||!input.id||['__proto__','constructor','prototype'].includes(input.id)||input.id.length>8192||typeof input.title!=='string'||!input.title.trim())throw Error('This book is missing its title or identity.');
 const b={id:input.id,title:text(input.title,1000)};
 for(const key of ['author','format'])if(typeof input[key]==='string')b[key]=text(input[key]);
 if(httpsUrl(input.poster))b.poster=httpsUrl(input.poster);
 if(typeof input.saved==='boolean')b.saved=input.saved;
 for(const key of ['savedAt','rating'])if(input[key]!==undefined)b[key]=number(input[key],key==='rating'?5:1e15);
 if(input.progress&&typeof input.progress==='object'){
  b.progress={};for(const key of ['position','duration','trackIndex','lastPlayed','rate'])if(input.progress[key]!==undefined)b.progress[key]=number(input.progress[key],key==='lastPlayed'?1e15:1e9);
  if(typeof input.progress.finished==='boolean')b.progress.finished=input.progress.finished;
  if(Array.isArray(input.progress.trackDurations))b.progress.trackDurations=input.progress.trackDurations.slice(0,10000).map(v=>v===null?null:number(v));
 }
 if(Array.isArray(input.bookmarks))b.bookmarks=input.bookmarks.slice(0,1000).map(m=>({createdAt:number(m.createdAt,1e15),position:number(m.position),trackIndex:number(m.trackIndex),note:text(m.note,2000)}));
 return b;
}
function parseBackup(raw){
 if(typeof raw!=='string'||raw.length>10*1024*1024)throw Error('Choose a BusTAudio backup smaller than 10 MB.');
 let data;try{data=JSON.parse(raw);}catch{throw Error('This file is not a valid BusTAudio backup.');}
 if(data?.format!=='bustaudio-backup'||data.version!==1||!Array.isArray(data.books)||data.books.length>10000)throw Error('This backup format is not supported.');
 const unique=new Map();for(const b of data.books){if(b?.type==='comic')continue;const clean=sanitizeBook(b);unique.set(clean.id,clean);}return [...unique.values()];
}
function trustedSender(event,webContents,url){return event.sender===webContents&&event.senderFrame===webContents.mainFrame&&event.senderFrame?.url===url;}
class LibrarySession{
 constructor({request,persist}){this.request=request;this.persist=persist;this.epoch=0;this.clear();}
 clear(){this.epoch++;this.user=null;this.records=new Map();this.recoveries=new Map();this.queues=new Map();}
 bind(user,records=[],recoveries=[]){this.clear();this.user=user;for(const r of records)this.records.set(r.id,r);for(const r of recoveries)this.recoveries.set(r.id,r);}
 check(epoch){if(!this.user||epoch!==this.epoch)throw Error('Your account changed or you signed out.');}
 snapshot(){return {user:this.user,books:[...this.records.values()].filter(r=>!r.deleted&&r.book).map(r=>({...r.book,_revision:r.revision})),recoveries:[...this.recoveries.values()]};}
 stash(){this.persist({user:this.user,records:[...this.records.values()],recoveries:[...this.recoveries.values()]});}
 async refresh(){const epoch=this.epoch;this.check(epoch);const result=await this.request('/app/accounts/library');this.check(epoch);
  if(!Array.isArray(result.books))throw Error('Invalid server library.');
  const remote=new Map();for(const r of result.books){if(!r||typeof r.id!=='string'||!Number.isSafeInteger(r.revision)||r.revision<1||typeof r.deleted!=='boolean'||(!r.deleted&&r.book?.id!==r.id))throw Error('Invalid server library record.');remote.set(r.id,r.deleted?{...r,book:null}:{...r,book:sanitizeBook(r.book)});}
  for(const [id,old]of this.records){const r=remote.get(id);if(!r||r.revision<old.revision)throw Error('The cloud library is older or missing a saved revision. Sync stopped to protect your books.');}
  this.records=remote;this.stash();return this.snapshot();}
 save(input,deleted=false){const book=sanitizeBook(input);const epoch=this.epoch;
  const baseRevision=input._revision??0;if(!Number.isSafeInteger(baseRevision)||baseRevision<0)throw Error("Invalid library revision.");
  const previous=this.queues.get(book.id)||Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{this.check(epoch);
   if(this.recoveries.has(book.id))throw Error('Review the unsaved changes for this book before saving again.');
   try{if((this.records.get(book.id)?.revision||0)!==baseRevision)throw Object.assign(Error("This book changed on another device."),{status:409,record:this.records.get(book.id)});
   this.recoveries.set(book.id,{id:book.id,book,deleted,reason:'pending'});this.stash();
   const out=await this.request('/app/accounts/library/'+encodeURIComponent(book.id),{method:'PUT',body:deleted?{baseRevision,deleted:true}:{baseRevision,book}});this.check(epoch);this.records.set(book.id,out.record);this.recoveries.delete(book.id);this.stash();return {record:out.record};}
   catch(e){this.check(epoch);if(e.status===401)throw e;
    if(e.status===409&&e.record)this.records.set(book.id,e.record);
    this.recoveries.set(book.id,{id:book.id,book,deleted,reason:e.status===409?'conflict':'offline'});this.stash();
    if(e.status===409)return {conflict:true};throw e;
   }
  });this.queues.set(book.id,next);return next.finally(()=>{if(this.queues.get(book.id)===next)this.queues.delete(book.id);});
 }
 async resolve(id,choice){if(!['mine','remote'].includes(choice))throw Error('Choose which changes to keep.');const recovery=this.recoveries.get(id);if(!recovery)return this.snapshot();
  const reviewedRevision=this.records.get(id)?.revision||0;await this.refresh();
  if(choice==='mine'&&(this.records.get(id)?.revision||0)!==reviewedRevision)throw Error('The cloud copy changed again. Review the updated copy and choose again.');
  if(choice==='remote'){this.recoveries.delete(id);this.stash();return this.snapshot();}
  this.recoveries.delete(id);await this.save({...recovery.book,_revision:this.records.get(id)?.revision||0},recovery.deleted);return this.snapshot();
 }
}
module.exports={parseInstallLink,httpsUrl,sanitizeBook,parseBackup,trustedSender,LibrarySession};
