import express from 'express';
import multer from 'multer';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {parseGPX,paint,sample,exportGPX,num,SURFACES} from './geometry.js';
import {fetchSuggestions} from './osm.js';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const random=()=>randomBytes(24).toString('hex');
const equal=(a,b)=>{const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&timingSafeEqual(aa,bb);};
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const text=(v='',max=4000,required=false)=>{if(typeof v!=='string'||v.trim().length>max||(required&&!v.trim()))throw fail('Kontrollera textfältens längd och ruttnamnet.');return v.trim();};
function metadata(b){const category=b.category||'mixed';if(!['gravel','road','mtb','mixed'].includes(category))throw fail('Välj en ruttyp.');const source_url=text(b.source_url,500);if(source_url){let u;try{u=new URL(source_url);}catch{throw fail('Ogiltig ursprungslänk.');}if(!['http:','https:'].includes(u.protocol))throw fail('Länken måste börja med https:// eller http://.');}return {name:text(b.name,120,true),description:text(b.description),location:text(b.location,120),category,source_url,is_race_course:b.is_race_course===true||b.is_race_course==='on',is_strava_segment:b.is_strava_segment===true||b.is_strava_segment==='on'};}
export function createApp({dataDir=path.join(ROOT,'data'),password=process.env.ADMIN_PASSWORD,publicURL=process.env.PUBLIC_URL||'',suggest=fetchSuggestions}={}){
 mkdirSync(dataDir,{recursive:true});const configPath=path.join(dataDir,'config.json');
 const config=existsSync(configPath)?JSON.parse(readFileSync(configPath,'utf8')):{secret:random(),admin_code:randomBytes(12).toString('base64url')};
 if(!existsSync(configPath))writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
 const adminCode=password||config.admin_code;if(!adminCode)throw Error('Administratörskod saknas i config.json.');
 const hosts=new Set(['localhost','127.0.0.1']);if(publicURL){const u=new URL(publicURL);if(u.protocol!=='https:'||!['','/'].includes(u.pathname))throw Error('PUBLIC_URL måste vara en HTTPS-adress utan sökväg.');hosts.add(u.hostname);}
 const db=new DatabaseSync(path.join(dataDir,'routes.sqlite3'));db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS routes (id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE, payload TEXT NOT NULL)');
 // Normalize existing routes while retaining manual markings and all route metadata.
 for(const row of db.prepare('SELECT id,payload FROM routes').all()){
  const route=JSON.parse(row.payload);let changed=false;
  for(const span of route.surfaces||[])if(['other','paved','unpaved'].includes(span.kind)){span.kind='gravel';changed=true;}
  for(const key of ['is_race_course','is_strava_segment'])if(route[key]===undefined){route[key]=false;changed=true;}
  if(changed)db.prepare('UPDATE routes SET payload=? WHERE id=?').run(JSON.stringify(route),row.id);
 }
 const app=express();app.disable('x-powered-by');const sessions=new Map(),attempts=[];let osmBusy=false,osmLast=0;
 let suggestionQueue=Promise.resolve();
 const queuedSuggestion=points=>{const job=suggestionQueue.then(()=>suggest(points));suggestionQueue=job.catch(()=>{});return job;};
 const load=id=>{const row=db.prepare('SELECT payload FROM routes WHERE id=?').get(id);if(!row)throw fail('Rutten finns inte längre.',404);return JSON.parse(row.payload);};
 const save=r=>{r.revision++;r.updated=Math.floor(Date.now()/1000);db.prepare('UPDATE routes SET payload=? WHERE id=?').run(JSON.stringify(r),r.id);};
 app.use((req,res,next)=>{if(!hosts.has(req.hostname))return res.status(400).json({error:'Ogiltig värd.'});res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin'});if(req.path.startsWith('/api/'))res.set('Cache-Control','no-store');next();});
 app.use('/api',(req,res,next)=>{const cookies=Object.fromEntries((req.headers.cookie||'').split(';').filter(s=>s.includes('=')).map(s=>{const i=s.indexOf('=');return [s.slice(0,i).trim(),s.slice(i+1)];}));let id=cookies.ruttbank_session;let s=sessions.get(id);if(!s||s.expires<Date.now()){if(req.path!=='/session'){req.auth=null;return next();}if(sessions.size>10000){for(const [key,value] of sessions)if(value.expires<Date.now())sessions.delete(key);if(sessions.size>10000)return res.status(503).json({error:'Servern är upptagen.'});}id=random();s={csrf:random(),admin:false,expires:Date.now()+86400000};sessions.set(id,s);res.cookie('ruttbank_session',id,{httpOnly:true,sameSite:'strict',secure:!!publicURL,maxAge:86400000,path:'/'});}req.auth=s;next();});
 app.use(express.json({limit:'50kb'}));
 app.use('/api',(req,res,next)=>{if(['POST','PATCH','DELETE'].includes(req.method)){if(!req.auth||!equal(req.get('X-CSRF-Token'),req.auth.csrf))throw fail('Sessionen har gått ut. Ladda om sidan.',403);if(req.get('Origin')){let origin;try{origin=new URL(req.get('Origin'));}catch{throw fail('Otillåten begäran.',403);}if(origin.host!==req.get('Host'))throw fail('Otillåten begäran.',403);}}next();});
 const admin=(req,res,next)=>{if(!req.auth?.admin)throw fail('Logga in för att ändra ruttbanken.',401);next();};
 const body=req=>{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw fail('Ogiltig begäran.');return req.body;};
 app.get('/api/session',(req,res)=>res.json({csrf:req.auth.csrf,admin:req.auth.admin,tile_url:process.env.MAP_TILE_URL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png',tile_credit:process.env.MAP_TILE_CREDIT||'OpenStreetMap'}));
 app.post('/api/login',(req,res)=>{const b=body(req),now=Date.now();while(attempts.length&&now-attempts[0]>60000)attempts.shift();if(attempts.length>=10)throw fail('För många försök. Vänta en minut.',429);attempts.push(now);if(!equal(b.password,adminCode))throw fail('Fel administratörskod.',401);req.auth.admin=true;res.json({ok:true});});
 app.post('/api/logout',(req,res)=>{req.auth.admin=false;res.json({ok:true});});
 app.get('/api/routes',(req,res)=>{const routes=db.prepare('SELECT payload FROM routes').all().map(row=>{const r=JSON.parse(row.payload),{points,cafes,gpx_name,...summary}=r;return {...summary,preview:sample(points),cafe_count:cafes.length,surface_totals:Object.fromEntries(SURFACES.map(k=>[k,r.surfaces.filter(s=>s.kind===k).reduce((v,s)=>v+s.end-s.start,0)]))};}).sort((a,b)=>b.created-a.created);res.json({routes});});
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1,fields:8,fieldSize:10000}});
 app.post('/api/routes',admin,upload.single('file'),async(req,res)=>{const f=req.file;if(!f||!f.originalname.toLowerCase().endsWith('.gpx'))throw fail('Välj en GPX-fil.');const r=parseGPX(f.buffer),b={...req.body};if(!b.name?.trim())b.name=r.gpx_name||path.parse(f.originalname).name;Object.assign(r,metadata(b),{id:randomBytes(8).toString('hex'),created:Math.floor(Date.now()/1000),updated:Math.floor(Date.now()/1000),revision:1,cafes:[],surfaces:[{start:0,end:r.distance,kind:'unknown',source:'unknown'}]});const fingerprint=createHash('sha256').update(f.buffer).digest('hex');if(db.prepare('SELECT id FROM routes WHERE fingerprint=?').get(fingerprint))throw fail('Den här GPX-filen finns redan i ruttbanken.');try{const result=await queuedSuggestion(r.points);r.surfaces=result.spans;r.surface_diagnostics=result.diagnostics;r.surface_status='complete';}catch(error){r.surface_status='failed';r.surface_error=error.message;}
 if(db.prepare('SELECT id FROM routes WHERE fingerprint=?').get(fingerprint))throw fail('Den här GPX-filen finns redan i ruttbanken.');
 db.prepare('INSERT INTO routes VALUES (?,?,?)').run(r.id,fingerprint,JSON.stringify(r));res.status(201).json(r);});
 app.get('/api/routes/:id',(req,res)=>res.json(load(req.params.id)));
 app.patch('/api/routes/:id',admin,(req,res)=>{const b=body(req),r=load(req.params.id);if(b.revision!==r.revision)throw fail('Rutten har ändrats. Öppna den på nytt.',409);
  if(b.action==='metadata')Object.assign(r,metadata(b));
  else if(b.action==='surface')r.surfaces=paint(r.surfaces,b.start,b.end,b.kind,r.distance);
  else if(b.action==='cafe'){const lat=num(b.lat),lon=num(b.lon);if(Math.abs(lat)>90||Math.abs(lon)>180)throw fail('Välj en giltig plats.');if(r.cafes.length>=100)throw fail('Högst 100 fikastopp.');const closest=r.points.reduce((a,p)=>distanceTo(p)<distanceTo(a)?p:a);function distanceTo(p){return (p[0]-lat)**2+((p[1]-lon)*Math.cos(lat*Math.PI/180))**2;}r.cafes.push({id:randomBytes(6).toString('hex'),name:text(b.name,120,true),note:text(b.note,500),lat,lon,distance:closest[3]});}
  else if(b.action==='remove_cafe')r.cafes=r.cafes.filter(c=>c.id!==b.cafe_id);
  else throw fail('Okänd ändring.');save(r);res.json(r);
 });
 app.post('/api/routes/:id/suggest-surfaces',admin,async(req,res)=>{const r=load(req.params.id),b=body(req);if(b.revision!==r.revision)throw fail('Öppna rutten på nytt.',409);if(osmBusy||Date.now()-osmLast<60000)throw fail('Vänta en minut mellan karthämtningarna.',429);osmBusy=true;osmLast=Date.now();try{const result=await queuedSuggestion(r.points);let spans=result.spans;for(const s of r.surfaces)if(s.source==='manual')spans=paint(spans,s.start,s.end,s.kind,r.distance);if(load(r.id).revision!==r.revision)throw fail('Rutten ändrades under hämtningen. Inga förslag sparades.',409);r.surfaces=spans;r.surface_diagnostics=result.diagnostics;r.surface_status='complete';delete r.surface_error;save(r);res.json(r);}finally{osmBusy=false;}});
 app.delete('/api/routes/:id',admin,(req,res)=>{load(req.params.id);db.prepare('DELETE FROM routes WHERE id=?').run(req.params.id);res.json({ok:true});});
 app.get('/api/routes/:id/download',(req,res)=>{const r=load(req.params.id);res.attachment(r.name+'.gpx').type('application/gpx+xml').send(exportGPX(r));});
 app.get(['/', '/rutt/:id'],(req,res)=>res.set('Cache-Control','no-store').sendFile(path.join(ROOT,'dist','index.html')));
 app.use(express.static(path.join(ROOT,'dist'),{dotfiles:'deny',index:false,setHeaders:(res,file)=>{if(!file.includes(path.sep+'vendor'+path.sep))res.setHeader('Cache-Control','no-cache');}}));
 app.use((req,res)=>res.status(404).json({error:'Sidan finns inte.'}));
 app.use((err,req,res,next)=>{const message=err instanceof multer.MulterError?'Välj en GPX-fil på högst 20 MB.':err.message;res.status(err.status||400).json({error:message||'Begäran kunde inte hanteras.'});});
 return {app,db,adminCode};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(Number(process.versions.node.split('.')[0])<24)throw Error('Installera Node.js 24 eller senare.');
 const {app,db,adminCode}=createApp();const server=app.listen(8767,'127.0.0.1',()=>{const url=process.env.PUBLIC_URL||'http://localhost:8767';console.log('\nAlvins Ruttbank: '+url+'\nAdministrator: '+adminCode+'\nLat fonstret vara igang. Ctrl+C avslutar.\n');if(process.platform==='win32')execFile('rundll32',['url.dll,FileProtocolHandler',url],()=>{});});
 server.on('error',e=>{console.error('Kunde inte starta: '+e.message);db.close();process.exitCode=1;});process.on('SIGINT',()=>server.close(()=>{db.close();process.exit(0);}));
}
