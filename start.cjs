const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');const crypto=require('node:crypto');
process.chdir(__dirname);
if(Number(process.versions.node.split('.')[0])<24){console.error('Installera Node.js 24 LTS eller senare fran https://nodejs.org/');process.exit(1);}
const digest=crypto.createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex');const marker=path.join('node_modules','.route-library-installed');
if(!fs.existsSync(marker)||fs.readFileSync(marker,'utf8')!==digest){console.log('Installerar Node-paket. Detta behovs vid forsta starten och uppdateringar.');const r=process.platform==='win32'?cp.spawnSync('cmd.exe',['/d','/c','npm ci --omit=dev --ignore-scripts'],{stdio:'inherit'}):cp.spawnSync('npm',['ci','--omit=dev','--ignore-scripts'],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);fs.writeFileSync(marker,digest);}
const child=cp.spawn(process.execPath,['server.js'],{stdio:'inherit'});process.on('SIGINT',()=>child.kill('SIGINT'));child.on('exit',code=>process.exit(code||0));
