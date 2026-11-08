const path=require('node:path');const fs=require('node:fs');const {pipeline}=require('node:stream/promises');const {ZipFile}=require('yazl');
(async()=>{
 const {packager}=await import('@electron/packager');
 const out=path.join(__dirname,'build');fs.mkdirSync(out,{recursive:true});
 const apps=await packager({dir:__dirname,out,name:'BusTAudio',platform:'win32',arch:'x64',electronVersion:require('./package.json').devDependencies.electron,electronZipDir:process.env.ELECTRON_ZIP_DIR||undefined,overwrite:true,asar:true,prune:true,ignore:[/^\/build\.cjs$/,/^\/\.gitignore$/,/^\/build(?:\/|$)/,/^\/test(?:\/|$)/,/^\/package-lock\.json$/, /^\/README\.md$/]});
 const zipPath=path.join(out,`BusTAudio-${require('./package.json').version}-windows-x64.zip`);const archive=new ZipFile();
 function addFiles(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())addFiles(full);else archive.addFile(full,path.relative(out,full).split(path.sep).join('/'));}}
 addFiles(apps[0]);const writing=pipeline(archive.outputStream,fs.createWriteStream(zipPath));archive.end();await writing;console.log(zipPath);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
