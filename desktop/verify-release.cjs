'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const yaml=require('js-yaml');
function verifyRelease(directory,tag,previousPath){
 const info=yaml.load(fs.readFileSync(path.join(directory,'latest.yml'),'utf8'));
 if(!info||!/^\d+\.\d+\.\d+$/.test(info.version)||tag!==`desktop-v${info.version}`)throw Error('Release tag and manifest version must match.');
 if(previousPath){
  const previous=yaml.load(fs.readFileSync(previousPath,'utf8'));
  if(!previous||!/^\d+\.\d+\.\d+$/.test(previous.version))throw Error('Invalid previous stable version.');
  const nextParts=info.version.split('.').map(Number),oldParts=previous.version.split('.').map(Number);
  for(let i=0;i<3;i++){if(nextParts[i]<oldParts[i])throw Error('Cannot promote an older release: stable feed rollback rejected.');if(nextParts[i]>oldParts[i])break;}
  if(info.version===previous.version&&info.sha512!==previous.sha512)throw Error('Increment the version before replacing a released installer.');
 }
 const expected=`BusTAudio-Setup-${info.version}-x64.exe`;
 if(!Array.isArray(info.files)||info.files.length!==1||info.files[0].url!==expected||info.path!==expected)throw Error('Unexpected release asset name.');
 const file=info.files[0],payload=fs.readFileSync(path.join(directory,expected));
 const actual=crypto.createHash('sha512').update(payload).digest('base64');
 if(file.size!==payload.length||file.sha512!==actual||info.sha512!==actual)throw Error('Installer checksum or size does not match.');
 if(fs.statSync(path.join(directory,expected+'.blockmap')).size===0)throw Error('Missing installer blockmap.');
 return {version:info.version,file:expected,size:payload.length};
}
if(require.main===module){try{console.log(JSON.stringify(verifyRelease(process.argv[2],process.argv[3],process.argv[4])));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={verifyRelease};
