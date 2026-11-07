const {chromium}=require('playwright');const assert=require('node:assert/strict');const path=require('node:path');
const seconds=90,rate=8000,size=seconds*rate*2;const wav=Buffer.alloc(44+size);wav.write('RIFF');wav.writeUInt32LE(size+36,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(size,40);
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:1280,height:860}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://audio.example/**',route=>route.fulfill({status:200,contentType:'audio/wav',headers:{'Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*'},body:wav}));
 await page.addInitScript(()=>{
  let state={configured:true,server:'books.example',user:{id:'a',username:'alice'},books:[{id:'audio',title:'An Audible Journey',author:'Mira Lane',saved:true,_revision:1,progress:{position:12,duration:90,trackIndex:0,rate:1,lastPlayed:1},bookmarks:[]}],recoveries:[]};
  window.fixture={get state(){return structuredClone(state)},conflict:false};
  window.books={state:async()=>structuredClone(state),refresh:async()=>structuredClone(state),details:async()=>({description:'A tale in two parts.'}),streams:async()=>({ready:true,streams:[{title:'First part',url:'https://audio.example/one.wav'},{title:'Second part',url:'https://audio.example/two.wav'}]}),save:async book=>{
   if(window.fixture.conflict){state.books=[{...book,_revision:book._revision+1,progress:{...book.progress,position:60}}];state.recoveries=[{id:book.id,book,reason:'conflict'}];return {...structuredClone(state),conflict:true};}
   state.books=[{...book,_revision:book._revision+1}];return structuredClone(state);
  },logout:async()=>{state={...state,user:null,books:[],recoveries:[]};return structuredClone(state)},resolve:async()=>{state.recoveries=[];return structuredClone(state)}};
 });
 await page.goto('file://'+path.join(__dirname,'../ui/index.html'));
 await page.getByText('An Audible Journey',{exact:true}).click();await page.getByRole('button',{name:'Listen now',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('audio').currentTime>=12&&!document.querySelector('audio').paused);
 await page.getByLabel('Playback speed').selectOption('1.5');await page.waitForFunction(()=>window.fixture.state.books[0].progress.rate===1.5);
 await page.getByLabel('Listening position').fill('35');await page.getByLabel('Listening position').dispatchEvent('change');await page.waitForFunction(()=>window.fixture.state.books[0].progress.position>=35);
 await page.getByRole('button',{name:'Add bookmark'}).click();await page.waitForFunction(()=>window.fixture.state.books[0].bookmarks.length===1);
 assert.ok(await page.evaluate(()=>window.fixture.state.books[0].bookmarks[0].position>=35));
 await page.getByRole('button',{name:'Parts',exact:true}).click();await page.getByRole('button',{name:'2. Second part',exact:true}).click();
 // The details dialog may remain open while the chosen part starts.
 await page.waitForFunction(()=>document.querySelector('audio').src.endsWith('/two.wav')&&!document.querySelector('audio').paused);
 if(await page.getByRole('button',{name:'Close book details'}).isVisible())await page.getByRole('button',{name:'Close book details'}).click();
 await page.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForFunction(()=>window.fixture.state.books[0].progress.trackIndex===1);
 await page.screenshot({path:path.join(__dirname,'../build/desktop-player.png'),fullPage:true});
 await page.evaluate(()=>{window.fixture.conflict=true;});await page.getByLabel('Listening position').fill('45');await page.getByLabel('Listening position').dispatchEvent('change');
 await page.getByRole('heading',{name:'Review unsaved changes'}).waitFor();assert.equal(await page.evaluate(()=>document.querySelector('audio').paused),true);
 assert.equal(await page.evaluate(()=>window.fixture.state.books[0].progress.position),60);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Sign out and discard local changes',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.querySelector('audio').getAttribute('src')),null);assert.equal(await page.getByText('An Audible Journey',{exact:true}).count(),0);assert.deepEqual(errors,[]);
 console.log('Playback smoke passed: real WAV resume, speed, seek, bookmark, second part, progress, conflict pause, logout cleanup.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
