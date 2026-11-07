const {test}=require('node:test');
const assert=require('node:assert/strict');
let core; try {core=require('../core.cjs')} catch {core={}}
const book={id:'book-1',title:'A Book',author:'Someone',saved:true,progress:{position:14,duration:300,trackIndex:0}};
test('install links accept only secure single configuration paths',()=>{
 assert.equal(typeof core.parseInstallLink,'function');
 assert.equal(core.parseInstallLink('stremio://books.example/abc_DEF/manifest.json'),'https://books.example/abc_DEF');
 for(const value of ['http://host/key','https://user:pass@host/key','https://host/a/b','https://host/key?token=x','file:///secret','https://host/%2e%2e','https://host/key#x']) assert.throws(()=>core.parseInstallLink(value));
});
test('sync strips downloaded files, credentials and unsafe URLs',()=>{
 assert.equal(typeof core.sanitizeBook,'function');
 const result=core.sanitizeBook({...book,files:[{url:'file:///private'}],token:'secret',poster:'file:///x',progress:{...book.progress,localPath:'x'},bookmarks:[{createdAt:1,position:10,trackIndex:0,note:'Here',localUri:'x'}]});
 assert.equal(result.files,undefined);assert.equal(result.token,undefined);assert.equal(result.poster,undefined);assert.equal(result.progress.localPath,undefined);assert.equal(result.bookmarks[0].localUri,undefined);
 assert.throws(()=>core.sanitizeBook({...book,progress:{position:-5}}));
});
test('import validates envelope and strips device data',()=>{
 assert.equal(typeof core.parseBackup,'function');
 const result=core.parseBackup(JSON.stringify({format:'bustaudio-backup',version:1,books:[{...book,downloaded:true}, {...book,id:'comic',type:'comic'}]}));
 assert.equal(result.length,1);assert.equal(result[0].downloaded,undefined);
 assert.throws(()=>core.parseBackup('{"format":"other","books":[]}'));
});
test('only the trusted main frame can invoke desktop commands',()=>{
 assert.equal(typeof core.trustedSender,'function');
 const frame={url:'file:///app/ui/index.html'};const sender={mainFrame:frame};
 assert.equal(core.trustedSender({sender,senderFrame:frame},sender,frame.url),true);
 assert.equal(core.trustedSender({sender,senderFrame:{url:frame.url}},sender,frame.url),false);
 assert.equal(core.trustedSender({sender,senderFrame:frame},sender,'https://evil.example'),false);
});
test('conflicts preserve remote state and require explicit draft recovery',async()=>{
 assert.equal(typeof core.LibrarySession,'function');
 const remote={id:book.id,revision:3,deleted:false,book:{...book,progress:{position:99}}};
 let writes=0;
 const session=new core.LibrarySession({request:async(path,opt)=>{ if(opt?.method==='PUT'){writes++;if(writes===1)throw Object.assign(new Error('conflict'),{status:409,record:remote});return {record:{...remote,revision:4,book:opt.body.book}};}return {books:[{...remote,revision:writes?3:2}]};},persist:()=>{}});
 session.bind({id:'a',username:'a'},[]);await session.refresh();
 const result=await session.save({...book,_revision:2});
 assert.equal(result.conflict,true);assert.equal(session.snapshot().books[0].progress.position,99);assert.equal(session.snapshot().recoveries[0].book.progress.position,14);assert.equal(writes,1);
 await session.resolve(book.id,'mine');assert.equal(writes,2);assert.equal(session.snapshot().books[0].progress.position,14);
});
test('logout rejects in-flight responses and clears drafts and account books',async()=>{
 assert.equal(typeof core.LibrarySession,'function');
 let finish; const session=new core.LibrarySession({request:()=>new Promise(r=>finish=r),persist:()=>{}});
 session.bind({id:'alice'},[{id:book.id,revision:1,book}]);
 const pending=session.save({...book,_revision:1});await new Promise(r=>setImmediate(r));session.clear();finish({record:{id:book.id,revision:2,book}});
 await assert.rejects(pending,/changed|signed out/i);assert.deepEqual(session.snapshot().books,[]);assert.deepEqual(session.snapshot().recoveries,[]);
});
test('failed saves do not replay on refresh and survive as deliberate recoveries',async()=>{
 assert.equal(typeof core.LibrarySession,'function');let writes=0;
 const session=new core.LibrarySession({request:async(path,opt)=>{if(opt?.method==='PUT'){writes++;throw Error('offline')}return {books:[{id:book.id,revision:5,deleted:false,book:{...book,title:'New remote'}}]};},persist:()=>{}});
 session.bind({id:'a'},[{id:book.id,revision:1,book}]);await assert.rejects(session.save({...book,title:'Draft',_revision:1}));await session.refresh();
 assert.equal(writes,1);assert.equal(session.snapshot().books[0].title,'New remote');assert.equal(session.snapshot().recoveries[0].book.title,'Draft');
});
test('a player holding an older revision cannot overwrite a newly refreshed book',async()=>{
 let writes=0;const session=new core.LibrarySession({request:async(_p,opt)=>{if(opt?.method==='PUT'){writes++;return {record:{id:book.id,revision:4,book:opt.body.book}};}return {books:[{id:book.id,revision:3,deleted:false,book:{...book,title:'Remote'}}]};},persist:()=>{}});
 session.bind({id:'a'},[{id:book.id,revision:1,book}]);const old=session.snapshot().books[0];await session.refresh();const result=await session.save({...old,title:'Player draft'});assert.equal(result.conflict,true);assert.equal(writes,0);assert.equal(session.snapshot().books[0].title,'Remote');
});
test('an in-flight save has a durable draft before the network responds',async()=>{
 let finish,cache;const session=new core.LibrarySession({request:()=>new Promise(r=>finish=r),persist:value=>{cache=structuredClone(value);}});
 session.bind({id:'a'},[{id:book.id,revision:1,deleted:false,book}]);
 const pending=session.save({...book,_revision:1,progress:{position:123}});await new Promise(r=>setImmediate(r));
 assert.equal(cache.recoveries[0].book.progress.position,123);
 finish({record:{id:book.id,revision:2,deleted:false,book:{...book,progress:{position:123}}}});await pending;
 assert.equal(cache.recoveries.length,0);
});
test('refresh detects missing or rolled-back cloud revisions',async()=>{
 const session=new core.LibrarySession({request:async()=>({books:[]}),persist:()=>{}});
 session.bind({id:'a'},[{id:book.id,revision:4,deleted:false,book}]);
 await assert.rejects(session.refresh(),/older|missing/i);
});
test('a cloud change during conflict review requires another explicit choice',async()=>{
 let writes=0;const session=new core.LibrarySession({request:async(_p,opt)=>{if(opt?.method==='PUT'){writes++;throw Error('unexpected write');}return {books:[{id:book.id,revision:3,deleted:false,book:{...book,title:'Changed again'}}]};},persist:()=>{}});
 session.bind({id:'a'},[{id:book.id,revision:2,deleted:false,book}],[{id:book.id,book:{...book,title:'My draft'},deleted:false,reason:'conflict'}]);
 await assert.rejects(session.resolve(book.id,'mine'),/changed again/i);assert.equal(writes,0);assert.equal(session.snapshot().recoveries.length,1);assert.equal(session.snapshot().books[0].title,'Changed again');
});
