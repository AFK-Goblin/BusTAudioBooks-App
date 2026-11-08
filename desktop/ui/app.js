'use strict';
const api = window.books;
const app = document.getElementById('app');
const audio = document.getElementById('audio');
const dialog = document.getElementById('details');
const detailContent = document.getElementById('detail-content');
let state = {books:[],recoveries:[]}, page = 'library', filter = 'All', query = '', results = [], searchPage = 1;
let generation = 0, detailGeneration = 0, active = null, playerNode, saveQueue = Promise.resolve(), lastSave = 0, noticeTimer;
let timeNode, seekNode, playNode, importPreview = null, libraryQuery = '', librarySort = 'recent', signingOut = false;
let closing = false, playbackGeneration = 0;
let desktop = {version:'',accent:'violet',updates:{status:'disabled'}}, updateRevision = 0, installing = false;
const accents = {violet:'Violet',blue:'Blue',teal:'Teal',orange:'Orange',pink:'Pink'};
function icon(name) {
  const paths = {library:'M4 4h5v16H4z M12 4h3v16h-3z M18 4l3 15',search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',settings:'M4 7h16 M4 17h16 M8 4v6 M16 14v6',play:'M8 5l11 7-11 7z',headphones:'M4 14v-2a8 8 0 0 1 16 0v2 M4 13h3v7H4z M17 13h3v7h-3z',refresh:'M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 14 6 M4 12a8 8 0 0 0 14 6',download:'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5'};
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'20',height:'20',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[name]||paths.library);svg.append(path);return svg;
}
function applyAccent(key) { desktop.accent=accents[key]?key:'violet';document.documentElement.dataset.accent=desktop.accent; }
function updateStatus(value) { if(value?.status){desktop.updates=value;updateRevision++;renderUpdates();} }
function playbackLocked() { return installing || desktop.updates.status==='installing'; }
async function restartForUpdate() {
  if(installing||desktop.updates.status!=='ready')return;
  installing=true;playbackGeneration++;renderUpdates();audio.pause();
  try {
    await checkpoint();state=await api.state();
    if(active?.blocked||state.recoveries.length){notice('Resolve unsaved changes before restarting to update.',true);return;}
    updateStatus(await api.installUpdate());
  } finally { installing=false;renderUpdates(); }
}
function renderUpdates() {
  const update=desktop.updates, status=update.status;
  for(const slot of document.querySelectorAll('.update-slot')) {
    slot.replaceChildren();
    if(status==='ready')slot.append(el('div',{class:'update-banner'},icon('download'),el('span',{},`Update${update.version?' '+update.version:''} is ready`),button('Restart to update',restartForUpdate,'quiet')));
    const action=slot.querySelector('button');if(action)action.disabled=installing;
  }
  const card=document.querySelector('.update-card');if(!card)return;
  const messages={disabled:'Automatic updates are available in the installed Windows app. Install the latest setup to enable them.',idle:'Updates download automatically in the background. You choose when to restart.',checking:'Checking for updates…',downloading:`Downloading update${update.version?' '+update.version:''}…`,ready:`Update${update.version?' '+update.version:''} is ready to install. Restart when you’re ready.`,current:'You’re up to date.',error:update.message||'Could not check for updates. Please try again.',installing:'Restarting to install the update…'};
  card.replaceChildren(el('div',{class:'panel-heading'},icon('download'),el('h2',{},'App updates'),el('small',{class:'version'},desktop.version?'Version '+desktop.version:'Windows app')),el('p',{'role':'status'},messages[status]||messages.idle));
  if(status==='downloading')card.append(el('progress',{max:100,value:Number.isFinite(update.percent)?update.percent:undefined,'aria-label':'Update download progress'}));
  if(status==='ready')card.append(button('Restart to update',restartForUpdate,'primary'),el('small',{class:'update-note'},'Playback pauses and your place is saved before restarting.'));
  else if(['idle','current','error'].includes(status)&&api.checkForUpdates)card.append(button(status==='error'?'Try again':'Check for updates',async()=>updateStatus(await api.checkForUpdates())));
  if(installing)for(const item of card.querySelectorAll('button'))item.disabled=true;
}
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function button(text, action, className = '') { return el('button',{type:'button',class:className,onClick:()=>run(action)},text); }
function notice(message, error = false) {
  const node = document.getElementById('notice'); node.textContent = message; node.className = 'visible' + (error ? ' error' : '');
  clearTimeout(noticeTimer); noticeTimer = setTimeout(()=>{node.className='';},8000);
}
async function run(action) {
  if(playbackLocked())return;
  try { return await action(); }
  catch(error) {
    notice(error.message || 'Something went wrong. Please try again.', true);
    const next = await api.state().catch(()=>null);
    if (next) { state = next; if (!state.user) stopPlayer(); render(); }
  }
}
function brand() { return el('div',{class:'brand'},el('span',{class:'brand-mark'},icon('headphones')), 'BusTAudio'); }
function field(label, type, name, value='') { return el('label',{},label,el('input',{type,name,value,required:true,autocomplete:type==='password'?'current-password':'off'})); }
function accept(next) { state = next; render(); }
function safeUrl(value) { try { const url = new URL(value); return url.protocol==='https:' && !url.username && !url.password ? url.href : null; } catch { return null; } }
function cover(book) {
  const node=el('div',{class:'cover'}), url=safeUrl(book.poster);
  if (url) node.append(el('img',{src:url,alt:'',loading:'lazy',referrerpolicy:'no-referrer',onError:event=>event.target.replaceWith(el('span',{class:'initials'},book.title.slice(0,2)))}));
  else node.append(el('span',{class:'initials'},book.title.split(/\s+/).slice(0,2).map(s=>s[0]).join('')));
  if (book.progress?.finished) node.append(el('span',{class:'badge'},'Finished'));
  return node;
}
function current(book) { return state.books.find(b=>b.id===book.id)||book; }
function renderAuth(mode = 'login', configure = !state.configured) {
  detailContent.replaceChildren();
  const card=el('section',{class:'auth-card'},el('div',{class:'eyebrow'},'Your next chapter'));
  const form=el('form',{});
  if (configure) {
    card.append(el('h2',{},'Connect your library'),el('p',{},'Paste the BusTAudio install link you use on your phone. Everyone can browse the same catalogue with their own private library.'));
    form.append(field('Install link','url','link'),el('button',{class:'primary',type:'submit'},'Connect'));
  } else {
    card.append(el('h2',{},mode==='register'?'Create your account':'Welcome back'),el('p',{},`Your private library on ${state.server}.`));
    form.append(field('Username','text','username'),field('Password','password','password'));
    form.querySelector('[name=username]').autocomplete='username';
    if(mode==='register') {
      form.querySelector('[name=password]').autocomplete='new-password';
      form.querySelector('[name=password]').minLength=12;
      form.append(field('Invitation code','text','invite'),el('small',{},'Ask the library owner for an invitation. Use a lowercase username and a password of at least 12 characters.'));
    }
    form.append(el('button',{class:'primary',type:'submit'},mode==='register'?'Create account':'Sign in'));
  }
  form.addEventListener('submit',event=>{event.preventDefault();run(async()=>{
    const submit=form.querySelector('[type=submit]');submit.disabled=true;
    try {
      const values=Object.fromEntries(new FormData(form));
      const next=configure?await api.configure(values.link):await api[mode](values);
      generation++;page='library';filter='All';query='';results=[];accept(next);
    } finally {submit.disabled=false;}
  });});
  card.append(form);
  if(!configure) card.append(button(mode==='login'?'Have an invitation? Create account':'Already have an account? Sign in',()=>renderAuth(mode==='login'?'register':'login'),'switch'),el('div',{},button('Change install link',()=>renderAuth('login',true),'switch')));
  else if(state.configured)card.append(button('Back to sign in',()=>renderAuth(),'switch'));
  app.replaceChildren(el('main',{class:'auth'},el('section',{class:'auth-story'},brand(),el('div',{},el('div',{class:'eyebrow'},'A little time. A different world.'),el('h1',{},'Make room for a good story.'),el('p',{},'One shared catalogue. Your own books, bookmarks and place in every story.')),el('small',{},'BusTAudio for Windows')),card));
}
function render() {
  if (!state.user) { dialog.close(); detailGeneration++; renderAuth(); return; }
  const sidebar=el('aside',{class:'sidebar'},brand());
  const nav=el('nav',{'aria-label':'Main navigation'});
  for (const [key,title] of [['library','Your library'],['search','Search catalogue'],['settings','Settings']]) { const item=button('',()=>{page=key;render();},'nav'+(page===key?' active':''));item.append(icon(key),title);if(page===key)item.setAttribute('aria-current','page');nav.append(item); }
  sidebar.append(el('div',{class:'sidebar-label'},'YOUR LISTENING SPACE'),nav,el('div',{class:'sidebar-note'},icon('headphones'),el('p',{},'Good stories.\nAlways with you.')),el('div',{class:'account'},el('span',{class:'avatar'},state.user.username[0].toUpperCase()),el('div',{},el('strong',{},state.user.username),el('small',{},'Personal library'))));
  const content=el('main',{class:'content'});
  content.append(el('div',{class:'update-slot'}));
  const shell=el('div',{class:'shell'},sidebar,content);
  if(page==='library')renderLibrary(content);
  else if(page==='search')renderSearch(content);
  else renderSettings(content);
  playerNode=el('footer',{class:'player inactive'}); shell.append(playerNode);
  app.replaceChildren(shell);renderPlayer();renderUpdates();
}
function heading(node,title,description,action) { node.append(el('header',{class:'topbar'},el('div',{},el('div',{class:'eyebrow'},'A LITTLE TIME. A DIFFERENT WORLD.'),el('h1',{},title),el('p',{},description)),action)); }
function describeCopy(book, deleted = false) {
  if(deleted || !book)return 'Removed from library';
  return [book.progress?.finished?'Finished':('Part '+((book.progress?.trackIndex||0)+1)+' · '+clock(book.progress?.position)), (book.bookmarks?.length||0)+' bookmarks',book.saved?'Saved':'Not saved'].join(' · ');
}
function recoveryPanel(node) {
  if(!state.recoveries.length)return;
  const list=el('div',{class:'recovery-list'});
  for(const item of state.recoveries)list.append(el('div',{class:'recovery-item'},el('h3',{},item.book.title),el('p',{},['offline','pending'].includes(item.reason)?'Your changes are stored on this computer and have not reached the server.':'There are different changes to this book. Choose the copy to keep.'),el('p',{},'This computer: '+describeCopy(item.book,item.deleted)),el('p',{},'Cloud: '+describeCopy(state.books.find(b=>b.id===item.id))),el('div',{class:'row'},button('Keep my changes',()=>resolve(item.id,'mine')),button('Use cloud copy',()=>resolve(item.id,'remote')))));
  node.append(el('section',{class:'panel recovery'},el('h2',{},'Review unsaved changes'),el('p',{},'Playback is paused for books awaiting a decision. Your choices include listening progress, bookmarks and saved status.'),list));
}
async function resolve(id,choice) {
  if(active?.book.id===id)stopPlayer();
  accept(await api.resolve(id,choice));notice('Library choice saved.');
}
function cards(books) {
  if(!books.length)return el('div',{class:'empty'},el('h2',{},'Room for your next story'),el('p',{},'Search the catalogue to add a book to your personal library.'));
  return el('div',{class:'grid'},books.map(book=>{
    const card=button('',()=>openDetails(book),'book');card.title=book.title;
    card.append(cover(book),el('h3',{},book.title),el('p',{},book.author||'Audiobook'));
    if(book.progress?.lastPlayed)card.append(el('small',{class:'book-meta'},book.progress.finished?'Completed':`Part ${(book.progress.trackIndex||0)+1} · ${clock(book.progress.position)} listened`));
    if(book.progress?.duration>0)card.append(el('div',{class:'book-progress'},el('progress',{max:book.progress.duration,value:book.progress.position||0,'aria-label':'Listening progress'})));
    return card;
  }));
}
function renderLibrary(node) {
  heading(node,'Your library','Pick up where you left off, or begin something new.',button('Refresh library',async()=>accept(await api.refresh())));
  recoveryPanel(node);
  const recent=[...state.books].filter(book=>book.progress?.lastPlayed&&!book.progress.finished&&!state.recoveries.some(item=>item.id===book.id)).sort((a,b)=>b.progress.lastPlayed-a.progress.lastPlayed)[0];
  if(recent&&filter==='All'&&!libraryQuery) {
    const resume=button('',()=>listen(current(recent)),'primary continue-button');resume.append(icon('play'),'Continue listening');
    node.append(el('section',{class:'continue-card','aria-label':'Continue your last audiobook'},cover(recent),el('div',{class:'continue-copy'},el('div',{class:'eyebrow'},'PICK UP WHERE YOU LEFT OFF'),el('h2',{},'Back to '+recent.title),el('p',{},recent.author||'Audiobook'),el('small',{},`Part ${(recent.progress.trackIndex||0)+1} · ${clock(recent.progress.position)} into this part`),resume)));
  }
  const tabs=el('div',{class:'tabs','aria-label':'Library filters'});
  for(const label of ['All','Continue listening','Saved','Finished'])tabs.append(button(label,()=>{filter=label;render();},filter===label?'active':''));
  node.append(tabs);
  let books=[...state.books].sort((a,b)=>(b.progress?.lastPlayed||b.savedAt||0)-(a.progress?.lastPlayed||a.savedAt||0));
  if(filter==='Continue listening')books=books.filter(b=>b.progress?.lastPlayed&&!b.progress.finished);
  if(filter==='Saved')books=books.filter(b=>b.saved);
  if(filter==='Finished')books=books.filter(b=>b.progress?.finished);
  if(librarySort==='title')books.sort((a,b)=>a.title.localeCompare(b.title));
  const grid=el('div',{}), count=el('small',{});
  const draw=()=>{const filtered=books.filter(b=>(b.title+' '+(b.author||'')).toLowerCase().includes(libraryQuery.toLowerCase()));count.textContent=filtered.length+' books';grid.replaceChildren(cards(filtered));};
  const search=el('input',{type:'search',value:libraryQuery,placeholder:'Find a book in your library','aria-label':'Search your library',onInput:event=>{libraryQuery=event.target.value;draw();}});
  const sort=el('select',{'aria-label':'Sort your library',onChange:event=>{librarySort=event.target.value;render();}},el('option',{value:'recent'},'Recently listened'),el('option',{value:'title'},'Book title'));sort.value=librarySort;
  node.append(el('div',{class:'toolbar'},search,sort),el('div',{class:'section-title'},el('h2',{},filter==='All'?'Your books':filter),count),grid);draw();
}
function renderSearch(node) {
  heading(node,'Find your next listen','Browse the shared catalogue. The books you save belong to your account.');
  const input=el('input',{type:'search',value:query,placeholder:'Title or author','aria-label':'Search audiobooks',required:true,maxlength:300});
  const submit=el('button',{type:'submit',class:'primary'},'Search');
  const form=el('form',{class:'toolbar'},input,submit);
  form.addEventListener('submit',event=>{event.preventDefault();query=input.value.trim();run(()=>search(1));});
  node.append(form);
  if(results.length)node.append(cards(results),el('div',{class:'toolbar'},button('Previous page',()=>search(Math.max(1,searchPage-1))),el('small',{},`Page ${searchPage}`),button('Next page',()=>search(searchPage+1))));
  else node.append(el('div',{class:'empty'},el('h2',{},query?'No books found':'What are you in the mood for?'),el('p',{},query?'Try another title or author.':'Search by book title or author to get started.')));
}
async function search(number) {
  if(!query)return;
  const version=++generation;
  notice('Searching the catalogue…');
  const found=await api.search(query,number);
  if(version!==generation||!state.user)return;
  results=found;searchPage=number;page='search';render();notice(`${found.length} books found.`);
}
function renderSettings(node) {
  heading(node,'Settings','Your account and library on this computer.');
  recoveryPanel(node);
  const choices=el('div',{class:'accent-choices','aria-label':'Accent colour'});
  for(const [key,name] of Object.entries(accents)) {const choice=button('',async()=>{applyAccent(api.setAccent?await api.setAccent(key):key);for(const item of choices.querySelectorAll('button'))item.setAttribute('aria-pressed',String(item.dataset.colour===desktop.accent));},'accent-choice');choice.dataset.colour=key;choice.setAttribute('aria-pressed',String(key===desktop.accent));choice.append(el('span',{class:'swatch','aria-hidden':'true'}),name);choices.append(choice);}
  node.append(el('section',{class:'panel'},el('h2',{},'Appearance'),el('p',{},'The same familiar dark theme as your phone. Choose an accent for this computer.'),choices),el('section',{class:'panel update-card','aria-label':'App updates'}));
  if(signingOut)node.append(el('section',{class:'panel recovery'},el('h2',{},'Unsaved changes remain on this computer'),el('p',{},'Signing out now will discard these local changes. You can cancel and resolve them first.'),button('Sign out and discard local changes',()=>logout(true)),button('Stay signed in',()=>{signingOut=false;render();})));
  node.append(el('section',{class:'panel'},el('h2',{},'Listening across devices'),el('p',{},'Windows saves progress while you listen. On your phone, open Settings → Personal library and choose Sync now before switching devices. The phone asks before linking its existing books to your account.'),el('p',{},'Audio streams on Windows. Downloads already on your phone stay there.')));
  const backup=el('section',{class:'panel'},el('h2',{},'Bring your books with you'),el('p',{},'Import a BusTAudio JSON backup into your account. Audio files and server credentials are excluded. Existing books are held for your review.'));
  if(importPreview)backup.append(el('p',{},`${importPreview.count} books selected: ${importPreview.titles.join(', ')}`),el('div',{class:'row'},button(`Import into ${state.user.username}`,async()=>{const next=await api.confirmImport();importPreview=null;accept(next);notice('Import finished. Review any conflicting books in your library.');},'primary'),button('Cancel import',async()=>{await api.cancelImport();importPreview=null;render();})));
  else backup.append(button('Choose backup',async()=>{importPreview=await api.previewImport();render();}));
  node.append(backup,el('section',{class:'panel'},el('h2',{},`Signed in as ${state.user.username}`),el('p',{},`Connected to ${state.server}. Signing out removes this account’s local library cache from the app.`),button('Sign out',logout)));
}
async function logout(discard = false) {
  generation++;detailGeneration++;
  audio.pause();
  try { await checkpoint(); } catch { /* Unsaved changes are deliberately discarded at sign-out. */ }
  state=await api.state();
  if(state.recoveries.length&&!discard){signingOut=true;page='settings';render();return;}
  signingOut=false;stopPlayer();dialog.close();importPreview=null;results=[];query='';libraryQuery='';
  accept(await api.logout());
}
async function openDetails(input) {
  let book=current(input);const version=++detailGeneration;
  detailContent.replaceChildren();
  const top=el('div',{class:'detail-top'},cover(book),el('div',{},el('div',{class:'eyebrow'},book.format||'Audiobook'),el('h2',{},book.title),el('p',{},book.author||'Unknown author')));
  const actions=el('div',{class:'row'});
  const saveButton=button(book.saved?'Saved to library':'Save to library',async()=>{
    await updateBook({...current(book),saved:true,savedAt:book.savedAt||Date.now()});book=current(book);saveButton.textContent='Saved to library';
  });
  actions.append(saveButton,button('Listen now',()=>listen(current(book)),'primary'),button(book.progress?.finished?'Mark unfinished':'Mark finished',async()=>{
    const latest=current(book);await updateBook({...latest,progress:{...latest.progress,finished:!latest.progress?.finished}});await openDetails(current(book));
  }));
  if(state.books.some(b=>b.id===book.id))actions.append(button('Remove from library',async()=>{
    if(active?.book.id===book.id){audio.pause();await checkpoint();stopPlayer();}
    accept(await api.remove(current(book)));dialog.close();notice('Book removed from your library.');
  }));
  const description=el('p',{class:'description'},'Loading book details…');
  detailContent.append(top,actions,description);
  if(active?.book.id===book.id) {
    const parts=el('div',{class:'parts'},el('h3',{},'Parts'));
    active.streams.forEach((stream,index)=>parts.append(button(`${index+1}. ${stream.title}`,()=>changeTrack(index,0))));detailContent.append(parts);
  }
  if(book.bookmarks?.length) {
    detailContent.append(el('h3',{},'Bookmarks'));
    for(const mark of book.bookmarks)detailContent.append(el('div',{class:'bookmark'},el('span',{},mark.note||`Part ${mark.trackIndex+1} · ${clock(mark.position)}`),button('Listen here',()=>listen(current(book),mark.trackIndex,mark.position))));
  }
  if(!dialog.open)dialog.showModal();
  try {const data=await api.details(book.id);if(version===detailGeneration&&state.user)description.textContent=data.description||'No description is available for this book.';}
  catch(error){if(version===detailGeneration)description.textContent=error.message;}
}
async function updateBook(book) {
  if(active?.book.id===book.id){
    const target=active, finishedChanged=book.progress?.finished!==target.book.progress?.finished;
    audio.pause();await checkpoint();if(active!==target||target.blocked)return;
    book={...book,_revision:target.book._revision,progress:{...target.book.progress,...(finishedChanged?{finished:book.progress?.finished}: {})}};
  }
  const next=await api.save(book);accept(next);
  if(next.conflict){if(active?.book.id===book.id)stopPlayer();notice('This book changed elsewhere. Review the copies in Your library.',true);}
  else if(active?.book.id===book.id){active.book=current(book);active.finished=!!active.book.progress?.finished;}
}
function stopPlayer(){playbackGeneration++;if(active)active.blocked=true;active=null;audio.pause();audio.removeAttribute('src');audio.load();renderPlayer();}
async function listen(book,index,position) {
  if(state.recoveries.some(r=>r.id===book.id)){notice('Review this book’s unsaved changes in Your library first.',true);return;}
  const version=generation, loadVersion=++playbackGeneration, previous=active;
  let chosen=structuredClone(current(book));
  if(previous){audio.pause();await checkpoint();}
  if(version!==generation||loadVersion!==playbackGeneration||!state.user)return;
  if(previous?.book.id===chosen.id){if(previous.blocked)return;chosen=structuredClone(previous.book);}
  const chosenIndex=index??chosen.progress?.trackIndex??0, chosenPosition=position??chosen.progress?.position??0;
  const streams=await api.streams(chosen.id);
  if(version!==generation||loadVersion!==playbackGeneration||!state.user)return;
  if(!streams.ready||!streams.streams.length){notice('This audiobook is being prepared. Try Listen now again in a moment.');return;}
  stopPlayer();active={book:chosen,streams:streams.streams,index:Math.min(chosenIndex,streams.streams.length-1),blocked:false};
  dialog.close();await loadTrack(chosenPosition);
}
async function loadTrack(position) {
  if(playbackLocked())return;
  const target=active;if(!target)return;
  const stream=target.streams[target.index];
  target.resume=position;target.ready=false;audio.src=stream.url;audio.playbackRate=target.book.progress?.rate||1;
  renderPlayer();
  try{await audio.play();}catch(error){if(active===target)notice('Playback could not start. Press play to try again.',true);}
}
async function changeTrack(index,position) {
  if(!active||index<0||index>=active.streams.length)return;
  const target=active, loadVersion=++playbackGeneration;
  audio.pause();await checkpoint();if(active!==target||target.blocked||loadVersion!==playbackGeneration)return;
  target.index=index;await loadTrack(position);
}
function progressFor(target) {
  const durations=[...(target.book.progress?.trackDurations||[])];
  if(Number.isFinite(audio.duration))durations[target.index]=audio.duration;
  return {...target.book.progress,position:audio.currentTime||0,duration:Number.isFinite(audio.duration)?audio.duration:0,trackIndex:target.index,lastPlayed:Date.now(),finished:!!target.finished,trackDurations:Array.from(durations,v=>v??null),rate:audio.playbackRate};
}
function checkpoint() {
  const target=active;
  if(!target||target.blocked||!target.ready)return saveQueue;
  const progress=progressFor(target);
  const task=saveQueue.catch(()=>{}).then(async()=>{
    if(active!==target||target.blocked||!state.user)return;
    try {
      const next=await api.save({...target.book,progress});
      if(active!==target)return;
      state=next;
      if(next.conflict){target.blocked=true;audio.pause();render();notice('Another device changed this book. Review your changes before continuing.',true);return;}
      const saved=next.books.find(b=>b.id===target.book.id);
      if(saved)target.book=structuredClone(saved);
      lastSave=Date.now();
    } catch(error) {
      target.blocked=true;audio.pause();state=await api.state();render();notice('Progress could not be synced. Reconnect and review unsaved changes before continuing.',true);
    }
  });
  saveQueue=task;return task;
}
function clock(seconds) { const value=Math.max(0,Math.floor(seconds||0));return `${Math.floor(value/3600)?Math.floor(value/3600)+':':''}${String(Math.floor(value/60)%60).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`; }
function renderPlayer() {
  if(!playerNode)return;
  if(!active){playerNode.className='player inactive';playerNode.replaceChildren(el('span',{},'Choose a book and make yourself comfortable.'));return;}
  const target=active;playerNode.className='player';
  const title=el('div',{class:'player-title',title:target.book.title},target.book.title);
  const caption=el('div',{class:'player-caption',tabindex:0,title:target.streams[target.index].title},`Part ${target.index+1} · ${target.streams[target.index].title}`);
  playNode=button(audio.paused?'▶':'Ⅱ',async()=>{if(target.blocked){notice('Review unsaved changes before continuing.',true);return;}if(audio.paused)await audio.play();else{audio.pause();await checkpoint();}},'play');playNode.setAttribute('aria-label',audio.paused?'Play':'Pause');
  const transport=el('div',{class:'transport'},button('−15 s',()=>{audio.currentTime=Math.max(0,audio.currentTime-15);}),playNode,button('+30 s',()=>{audio.currentTime=Math.min(audio.duration||0,audio.currentTime+30);}));
  seekNode=el('input',{type:'range',min:0,max:Number.isFinite(audio.duration)?audio.duration:0,step:1,value:audio.currentTime||0,'aria-label':'Listening position',onChange:event=>{if(playbackLocked())return;audio.currentTime=Number(event.target.value);run(checkpoint);}});
  timeNode=el('span',{},clock(audio.currentTime));
  const duration=el('span',{},clock(audio.duration));
  const speed=el('select',{'aria-label':'Playback speed',onChange:event=>{if(playbackLocked())return;audio.playbackRate=Number(event.target.value);run(checkpoint);}},[0.75,1,1.25,1.5,1.75,2,2.5,3].map(rate=>el('option',{value:rate},rate+'×')));speed.value=String(audio.playbackRate);
  playerNode.replaceChildren(el('div',{class:'player-book'},cover(target.book),el('div',{class:'player-copy'},title,caption)),el('div',{class:'player-controls'},transport,el('div',{class:'scrubber'},timeNode,seekNode,duration)),el('div',{class:'player-side'},speed,button('Parts',()=>openDetails(active.book)),button('☆',async()=>{
    audio.pause();await checkpoint();if(!active||active.blocked)return;
    await updateBook({...active.book,bookmarks:[...(active.book.bookmarks||[]),{createdAt:Date.now(),position:audio.currentTime,trackIndex:active.index,note:''}]});notice('Bookmark added.');
  })));
  playerNode.querySelector('.player-side button:last-child').setAttribute('aria-label','Add bookmark');
}
audio.addEventListener('loadedmetadata',()=>{if(!active)return;audio.currentTime=Math.min(active.resume||0,Number.isFinite(audio.duration)?audio.duration:active.resume||0);active.ready=true;active.resume=0;renderPlayer();});
audio.addEventListener('timeupdate',()=>{if(timeNode)timeNode.textContent=clock(audio.currentTime);if(seekNode)seekNode.value=String(audio.currentTime);if(active?.ready&&!audio.paused&&Date.now()-lastSave>10000){lastSave=Date.now();run(checkpoint);}});
audio.addEventListener('play',()=>{if(playbackLocked()||active?.blocked){audio.pause();return;}if(playNode){playNode.textContent='Ⅱ';playNode.setAttribute('aria-label','Pause');}});
audio.addEventListener('pause',()=>{if(playNode){playNode.textContent='▶';playNode.setAttribute('aria-label','Play');}run(checkpoint);});
audio.addEventListener('ended',()=>run(async()=>{if(!active)return;if(active.index+1<active.streams.length)await changeTrack(active.index+1,0);else{active.finished=true;await checkpoint();notice('You’ve finished this audiobook.');render();}}));
audio.addEventListener('error',()=>{if(active)notice('The audio stream could not be opened. Open the book again to refresh its stream.',true);});
document.getElementById('close-details').addEventListener('click',()=>{detailGeneration++;dialog.close();});
dialog.addEventListener('click',event=>{if(event.target===dialog){detailGeneration++;dialog.close();}});
api.onUpdateStatus?.(updateStatus);
run(async()=>{const revision=updateRevision;const [next,info]=await Promise.all([api.state(),api.desktopInfo?.().catch(()=>null)]);state=next;if(info){desktop={...desktop,...info,updates:revision===updateRevision?info.updates:desktop.updates};}applyAccent(desktop.accent);render();});

api.onBeforeClose?.(()=>{if(closing)return;closing=true;audio.pause();checkpoint().finally(()=>api.close());});
