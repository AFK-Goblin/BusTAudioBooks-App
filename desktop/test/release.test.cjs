const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');
const {verifyRelease}=require('../verify-release.cjs');
test('release promotion rejects corrupted installers, mismatched tags and unsafe asset names',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bustaudio-release-'));try{
 const payload=Buffer.from('controlled installer bytes');const hash=crypto.createHash('sha512').update(payload).digest('base64');const name='BusTAudio-Setup-1.1.0-x64.exe';fs.writeFileSync(path.join(dir,name),payload);fs.writeFileSync(path.join(dir,name+'.blockmap'),'blockmap');
 const manifest=url=>`version: 1.1.0\nfiles:\n  - url: ${url}\n    sha512: ${hash}\n    size: ${payload.length}\npath: ${url}\nsha512: ${hash}\n`;
 fs.writeFileSync(path.join(dir,'latest.yml'),manifest(name));assert.equal(verifyRelease(dir,'desktop-v1.1.0').version,'1.1.0');
 assert.throws(()=>verifyRelease(dir,'desktop-v1.0.0'),/version|tag/i);
 fs.writeFileSync(path.join(dir,'latest.yml'),manifest('../'+name));assert.throws(()=>verifyRelease(dir,'desktop-v1.1.0'),/asset|name/i);
 fs.writeFileSync(path.join(dir,'latest.yml'),manifest(name));fs.writeFileSync(path.join(dir,name),'bad');assert.throws(()=>verifyRelease(dir,'desktop-v1.1.0'),/checksum|size/i);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('promotion cannot roll the stable feed back to an older release',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bustaudio-release-'));try{
 const payload=Buffer.from('installer'),name='BusTAudio-Setup-1.1.0-x64.exe',hash=crypto.createHash('sha512').update(payload).digest('base64');
 fs.writeFileSync(path.join(dir,name),payload);fs.writeFileSync(path.join(dir,name+'.blockmap'),'map');fs.writeFileSync(path.join(dir,'latest.yml'),`version: 1.1.0\nfiles:\n  - url: ${name}\n    sha512: ${hash}\n    size: 9\npath: ${name}\nsha512: ${hash}\n`);
 const previous=path.join(dir,'previous.yml');fs.writeFileSync(previous,'version: 1.2.0\n');assert.throws(()=>verifyRelease(dir,'desktop-v1.1.0',previous),/older|rollback/i);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
