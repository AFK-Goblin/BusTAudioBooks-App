const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createUpdates}=require('../updates.cjs');
function setup(enabled=true){
 const updater=new EventEmitter();let checks=0,installs=0,blocked=false,fail=false;
 updater.checkForUpdates=async()=>{checks++;if(fail)throw Error('secret provider URL');updater.emit('update-not-available');};
 const changed=[];
 const service=createUpdates({updater,enabled,version:'1.1.0',onStatus:value=>changed.push(value),canInstall:()=>!blocked,install:()=>{installs++;}});
 return {service,updater,changed,get checks(){return checks},get installs(){return installs},block:()=>{blocked=true;},fail:()=>{fail=true;},recover:()=>{fail=false;}};
}
test('portable and development builds do not contact the update service',async()=>{
 const f=setup(false);await f.service.check();assert.equal(f.checks,0);assert.equal(f.service.snapshot().status,'disabled');await assert.rejects(()=>f.service.install(),/install|available/i);assert.equal(f.installs,0);
});
test('checks coalesce and report current without exposing provider internals',async()=>{
 const f=setup();let release;f.updater.checkForUpdates=()=>{return new Promise(r=>{release=()=>{f.updater.emit('update-not-available');r();};});};
 const a=f.service.check(),b=f.service.check();assert.equal(f.service.snapshot().status,'checking');release();await Promise.all([a,b]);assert.equal(f.service.snapshot().status,'current');
});
test('download completion waits for explicit install and never installs on quit',async()=>{
 const f=setup();assert.equal(f.updater.autoDownload,true);assert.equal(f.updater.autoInstallOnAppQuit,false);
 await assert.rejects(()=>f.service.install(),/ready|download/i);
 f.updater.emit('update-available',{version:'1.2.0'});f.updater.emit('download-progress',{percent:42.8});
 assert.deepEqual(f.service.snapshot(),{status:'downloading',version:'1.2.0',percent:43});
 await f.service.check();assert.equal(f.checks,0);
 f.updater.emit('update-downloaded',{version:'1.2.0'});assert.equal(f.service.snapshot().status,'ready');assert.equal(f.installs,0);
 await f.service.install();assert.equal(f.installs,1);assert.equal(f.service.snapshot().status,'installing');
});
test('unsaved recovery prevents restart while retaining the downloaded update',async()=>{
 const f=setup();f.updater.emit('update-downloaded',{version:'1.2.0'});f.block();await assert.rejects(()=>f.service.install(),/unsaved/i);assert.equal(f.installs,0);assert.equal(f.service.snapshot().status,'ready');
});
test('failed downloads/checks expose a safe retryable message',async()=>{
 const f=setup();f.fail();await f.service.check();assert.equal(f.service.snapshot().status,'error');assert.doesNotMatch(JSON.stringify(f.service.snapshot()),/secret/);
 f.recover();await f.service.check();assert.equal(f.service.snapshot().status,'current');assert.equal(f.checks,2);
 f.updater.emit('error',Error('private token'));assert.equal(f.service.snapshot().status,'error');assert.doesNotMatch(JSON.stringify(f.service.snapshot()),/private/);
});
test('a failed background download is handled without an unhandled rejection',()=>{
 const {spawnSync}=require('node:child_process');
 const script=`const {EventEmitter}=require('node:events');const {createUpdates}=require(${JSON.stringify(require.resolve('../updates.cjs'))});const updater=new EventEmitter();updater.checkForUpdates=async()=>{updater.emit('update-available',{version:'1.2.0'});return {downloadPromise:Promise.reject(Error('offline mid-download'))};};const service=createUpdates({updater,enabled:true,version:'1.1.0'});service.check().then(()=>setImmediate(()=>{if(service.snapshot().status!=='error')process.exitCode=2;}));`;
 const result=spawnSync(process.execPath,['--unhandled-rejections=strict','-e',script],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
