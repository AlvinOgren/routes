'use strict';
const $=id=>document.getElementById(id);
const COLORS={unknown:'#8996a1',asphalt:'#12a2c0',gravel:'#d99013',trail:'#9862df'};
const LABELS={unknown:'Okänt',asphalt:'Asfalt',gravel:'Grus',trail:'MTB-stig / stig'};
const CATEGORIES={gravel:'Gravel',road:'Landsväg',mtb:'MTB',mixed:'Blandat'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,d=0)=>Number(n).toLocaleString('sv-SE',{minimumFractionDigits:d,maximumFractionDigits:d});
const state={position:null,nearby:false,locationRequest:0,routes:[],route:null,admin:false,csrf:'',category:'all',limit:8,pick:null,cafe:null,selection:[],afterLogin:null,nav:0};
let overview,detailMap,overviewLayers,routeLayers,hoverMarker,selectionLayer,toastTimer;
let previewObserver;const previewMaps=[];
function cleanPreviews(){previewObserver?.disconnect();for(const m of previewMaps)m.remove();previewMaps.length=0;}
function mountPreviews(routes){
 previewObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;previewObserver.unobserve(entry.target);const r=routes.find(r=>r.id===entry.target.dataset.route);if(!r)continue;
 const map=L.map(entry.target,{zoomControl:false,attributionControl:true,preferCanvas:true,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,touchZoom:false});previewMaps.push(map);
 L.tileLayer(state.tile_url,{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OSM</a>'+(state.tile_credit!=='OpenStreetMap'?' · '+esc(state.tile_credit):'')}).addTo(map);
 const layer=L.layerGroup().addTo(map);drawRoute(map,layer,r,true);map.fitBounds(r.preview.map(p=>p.slice(0,2)),{padding:[18,18],maxZoom:14});
 }},{threshold:.05});document.querySelectorAll('.preview-map').forEach(el=>previewObserver.observe(el));
}
function toast(message,failed=false){$('toast').textContent=message;$('toast').classList.toggle('failed',failed);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
async function api(url,options={}){
 const headers={...(options.headers||{})};
 if(options.method&&options.method!=='GET')headers['X-CSRF-Token']=state.csrf;
 if(options.body&&!(options.body instanceof FormData)){headers['Content-Type']='application/json';options.body=JSON.stringify(options.body);}
 let response;try{response=await fetch(url,{...options,headers});}catch{throw Error('Kunde inte nå servern. Kontrollera att appens startfönster är öppet.');}
 const data=await response.json().catch(()=>({error:'Servern kunde inte hantera begäran.'}));
 if(!response.ok)throw Error(data.error||'Något gick fel.');return data;
}
function icon(text,extra=''){return L.divIcon({className:'start-marker '+extra,html:esc(text),iconSize:[25,25],iconAnchor:[12,12]});}
function newMap(id,message){
 const map=L.map(id,{zoomControl:false,preferCanvas:true,attributionControl:true}).setView([58.40,15.62],10);
 L.control.zoom({position:'topright'}).addTo(map);
 const tiles=L.tileLayer(state.tile_url,{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'+(state.tile_credit!=='OpenStreetMap'?' · '+esc(state.tile_credit):'')});
 let errors=0;
 tiles.on('tileerror',()=>{if(++errors>=3){$(message).textContent='Bakgrundskartan kunde inte laddas. Ruttspåret visas ändå. Kontrollera internetanslutningen.';$(message).hidden=false;}});
 tiles.on('tileload',()=>{errors=0;$(message).hidden=true;});tiles.addTo(map);return map;
}
function interpolate(a,b,d){const t=b[3]===a[3]?0:(d-a[3])/(b[3]-a[3]);return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]===null||b[2]===null?null:a[2]+(b[2]-a[2])*t,d,a[4]];}
function pointAt(points,d){let lo=0,hi=points.length-1;while(lo<hi){const m=Math.ceil((lo+hi)/2);if(points[m][3]<=d)lo=m;else hi=m-1;}const a=points[lo],b=points[Math.min(lo+1,points.length-1)];return a[4]===b[4]?interpolate(a,b,Math.max(a[3],Math.min(b[3],d))):a;}
function coloredPaths(points,spans){
 const paths=[];let si=0;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i];if(a[4]!==b[4]||b[3]<=a[3])continue;
  let from=a[3];while(si<spans.length-1&&spans[si].end<=from)si++;
  while(from<b[3]-.000001){const s=spans[si]||{end:b[3],kind:'unknown'};const to=Math.min(b[3],s.end);if(to<=from){si++;continue;}
   const start=interpolate(a,b,from),end=interpolate(a,b,to);const last=paths[paths.length-1];
   if(last&&last.kind===s.kind&&last.segment===a[4]&&Math.abs(last.end-from)<.001){last.coords.push([end[0],end[1]]);last.end=to;}
   else paths.push({kind:s.kind,segment:a[4],end:to,coords:[[start[0],start[1]],[end[0],end[1]]]});
   from=to;if(si<spans.length-1&&s.end<=from)si++;
  }
 }
 return paths;
}
function drawRoute(map,layer,r,preview=false){
 const pts=preview?r.preview:r.points;const paths=coloredPaths(pts,r.surfaces);
 paths.forEach(path=>{L.polyline(path.coords,{color:'#061017',weight:preview?6:9,opacity:.75,interactive:false}).addTo(layer);const line=L.polyline(path.coords,{color:COLORS[path.kind],weight:preview?3:5,opacity:1,lineCap:'round'}).addTo(layer);if(preview)line.on('click',()=>navigate('/rutt/'+r.id));});
 if(pts.length&&!preview){L.marker(pts[0].slice(0,2),{icon:icon('S')}).bindTooltip('Start').addTo(layer);L.marker(pts[pts.length-1].slice(0,2),{icon:icon('M','end-marker')}).bindTooltip('Mål').addTo(layer);}
}
function fit(map,points){if(points.length)map.fitBounds(L.latLngBounds(points.map(p=>[p[0],p[1]])),{padding:[40,40],maxZoom:15});}
function thumbnail(r){
 const p=r.preview;const cos=Math.cos(p[0][0]*Math.PI/180);const xs=p.map(v=>v[1]*cos),ys=p.map(v=>-v[0]);
 const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 const scale=Math.min(270/Math.max(.00001,maxX-minX),130/Math.max(.00001,maxY-minY));
 const x=v=>(150+(v[1]*cos-(minX+maxX)/2)*scale).toFixed(2),y=v=>(80+(-v[0]-(minY+maxY)/2)*scale).toFixed(2);
 let path='';p.forEach((v,i)=>path+=(i===0||v[4]!==p[i-1][4]?'M':'L')+x(v)+' '+y(v));
 return `<svg viewBox="0 0 300 160" aria-hidden="true"><path d="${path}" fill="none" stroke="#b5ef63" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${x(p[0])}" cy="${y(p[0])}" r="5" fill="#0a1016" stroke="#b5ef63" stroke-width="2"/></svg>`;
}
function surfaceBar(spans,total){const totals={};spans.forEach(s=>totals[s.kind]=(totals[s.kind]||0)+s.end-s.start);return Object.entries(totals).map(([k,v])=>`<span style="width:${100*v/total}%;background:${COLORS[k]}" title="${LABELS[k]} ${fmt(100*v/total)} %"></span>`).join('');}
function startDistance(route){
 if(!state.position||!route.preview?.length)return Infinity;
 const [lat,lon]=route.preview[0],rad=Math.PI/180,a=state.position;
 const h=Math.sin((lat-a.latitude)*rad/2)**2+Math.cos(lat*rad)*Math.cos(a.latitude*rad)*Math.sin((lon-a.longitude)*rad/2)**2;
 return 6371.0088*2*Math.asin(Math.min(1,Math.sqrt(h)));
}
function filtered(){
 const query=$('search').value.trim().toLocaleLowerCase('sv');const surface=$('surface-filter').value;
 let result=state.routes.filter(r=>(state.category==='all'||r.category===state.category)&&(!query||[r.name,r.description,r.location].join(' ').toLocaleLowerCase('sv').includes(query))&&(!$('race-filter').checked||r.is_race_course===true)&&(!$('segment-filter').checked||r.is_strava_segment===true)&&(!$('cafe-filter').checked||r.cafe_count>0)&&(surface==='all'||r.surface_totals[surface]>0));
 if($('length').value!=='all'){const [a,b]=$('length').value.split(':').map(Number);result=result.filter(r=>r.distance/1000>=a&&r.distance/1000<b);}
 const sort=state.nearby?'near':$('sort').value;result.sort((a,b)=>sort==='near'?startDistance(a)-startDistance(b):sort==='short'?a.distance-b.distance:sort==='long'?b.distance-a.distance:sort==='climb'?(b.ascent??-1)-(a.ascent??-1):sort==='name'?a.name.localeCompare(b.name,'sv'):b.created-a.created);return result;
}
function renderLibrary(){
 cleanPreviews();
 const routes=filtered();$('total').textContent=`${state.routes.length} sparade rutter`;$('results').textContent=`${routes.length} ${routes.length===1?'rutt':'rutter'}`;
 $('clear').hidden=!(state.nearby||$('search').value||state.category!=='all'||$('length').value!=='all'||$('race-filter').checked||$('segment-filter').checked||$('cafe-filter').checked||$('surface-filter').value!=='all');
 $('cards').innerHTML=routes.slice(0,state.limit).map(r=>`<article class="route-card"><div class="thumb"><div class="preview-map map" data-route="${r.id}"></div><a class="preview-open" href="/rutt/${r.id}" aria-label="Öppna ${esc(r.name)}"></a><span class="badge">${CATEGORIES[r.category]}${r.is_race_course?' · Tävlingsbana':''}${r.is_strava_segment?' · Stravasegment':''}</span></div><a class="card-content" href="/rutt/${r.id}"><h2>${esc(r.name)}</h2><p class="card-location">${esc(r.location||'Ingen startplats angiven')}</p><div class="start-distance">${state.position?fmt(startDistance(r),1)+' km till start · fågelvägen':''}</div><div class="card-numbers"><div><b>${fmt(r.distance/1000,1)}</b> <span>km</span></div><div><b>${r.ascent===null?'—':fmt(r.ascent)}</b> <span>hm · ca</span></div></div><div class="card-footer"><div class="surface-bar">${surfaceBar(r.surfaces,r.distance)}</div>${r.cafe_count?`<span class="cafe-badge">☕ ${r.cafe_count} stopp</span>`:''}</div></a></article>`).join('');
 mountPreviews(routes);
 if(!routes.length)$('cards').innerHTML=`<div class="empty"><div class="empty-icon" aria-hidden="true">↗</div><h2>${state.routes.length?'Ingen rutt matchar filtren':'Din första runda väntar'}</h2><p>${state.routes.length?'Prova en annan sökning eller rensa filtren.':'Lägg till en GPX-fil för att samla rutten, underlagen och fikastoppen här.'}</p><button class="primary" id="empty-action">${state.routes.length?'Rensa filter':'Lägg till första rutten'}</button></div>`;
 $('empty-action')?.addEventListener('click',()=>state.routes.length?clearFilters():requestUpload());$('more').hidden=routes.length<=state.limit;
 if(overview){overviewLayers.clearLayers();routes.slice(0,100).forEach(r=>drawRoute(overview,overviewLayers,r,true));if(routes.length)fit(overview,routes.slice(0,100).flatMap(r=>r.preview));}
}
function clearFilters(){stopNearby();$('sort').value='new';$('search').value='';$('length').value='all';$('surface-filter').value='all';$('cafe-filter').checked=false;$('race-filter').checked=false;$('segment-filter').checked=false;setCategory('all');}
function setCategory(category){state.category=category;state.limit=8;document.querySelectorAll('[data-category]').forEach(b=>{const active=b.dataset.category===category;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);});renderLibrary();}
async function loadLibrary(){state.routes=(await api('/api/routes')).routes;renderLibrary();}
function renderChart(r){
 const p=r.points;const known=p.filter(v=>v[2]!==null);
 if(!known.length){$('chart').innerHTML='<p class="muted">GPX-filen saknar höjddata.</p>';$('elevation-info').textContent='';$('chart-readout').hidden=true;return;}
 $('chart-readout').hidden=false;const min=r.min_elevation,max=r.max_elevation,range=Math.max(10,max-min);
 const points=p.filter((_,i)=>i%Math.max(1,Math.floor(p.length/900))===0||i===p.length-1);
 const x=v=>35+v[3]/r.distance*830,y=v=>115-(v[2]-min)/range*95;
 let d='',previous=null;for(const v of points){if(v[2]===null){previous=null;continue;}d+=(previous&&v[4]===previous[4]?'L':'M')+x(v).toFixed(2)+' '+y(v).toFixed(2)+' ';previous=v;}
 $('chart').innerHTML=`<svg viewBox="0 0 900 145" preserveAspectRatio="none" role="img" aria-label="Höjdprofil, ${fmt(min)} till ${fmt(max)} meter"><path d="M35 115H865 M35 20H865" stroke="#2c3e4a" stroke-dasharray="3 6"/><path d="${d}" fill="none" stroke="#b5ef63" stroke-width="2.3" vector-effect="non-scaling-stroke"/><text x="35" y="138" fill="#9cabb7" font-size="12">0 km</text><text x="865" y="138" fill="#9cabb7" text-anchor="end" font-size="12">${fmt(r.distance/1000,1)} km</text></svg>`;
 $('elevation-info').textContent=`${fmt(min)}–${fmt(max)} m ö.h.`;
 $('chart').onpointermove=e=>{const box=$('chart').getBoundingClientRect();const f=Math.max(0,Math.min(1,((e.clientX-box.left)/box.width*900-35)/830));const v=pointAt(r.points,r.distance*f);$('chart-readout').textContent=`${fmt(v[3]/1000,2)} km från start · ${v[2]===null?'höjd saknas':fmt(v[2])+' m ö.h.'}`;if(detailMap){if(!hoverMarker)hoverMarker=L.circleMarker(v.slice(0,2),{radius:6,color:'#fff',fillColor:'#b5ef63',fillOpacity:1}).addTo(detailMap);else hoverMarker.setLatLng(v.slice(0,2));}};
}
function renderDetail(r,refit=true){
 state.route=r;$('route-name').textContent=r.name;document.title=r.name+' · Alvins Ruttbank';$('route-category').textContent=[CATEGORIES[r.category],r.is_race_course?'Tävlingsbana':'',r.is_strava_segment?'Stravasegment':''].filter(Boolean).join(' · ');$('route-location').textContent=r.location||'Ingen startplats angiven';
 $('download').href='/api/routes/'+r.id+'/download';$('km').innerHTML=fmt(r.distance/1000,1)+' <small>km</small>';$('ascent').innerHTML=(r.ascent===null?'—':fmt(r.ascent))+' <small>m</small>';$('descent').innerHTML=(r.descent===null?'—':fmt(r.descent))+' <small>m</small>';
 $('elevation-warning').hidden=r.elevation_coverage===1;$('elevation-warning').textContent=r.elevation_coverage===0?'Filen saknar användbar höjddata.':'Höjddata saknas på delar av spåret. Höjdmeterna kan vara underskattade.';
 $('description').textContent=r.description||'Ingen beskrivning ännu.';$('source').hidden=!r.source_url;if(r.source_url)$('source').href=r.source_url;
 $('surface-bar').innerHTML=surfaceBar(r.surfaces,r.distance);
 $('surface-legend').innerHTML=Object.keys(COLORS).map(k=>{const length=r.surfaces.filter(s=>s.kind===k).reduce((v,s)=>v+s.end-s.start,0);if(!length)return '';const estimate=r.surfaces.some(s=>s.kind===k&&s.source.startsWith('osm'));return `<div class="legend-row"><span><i class="swatch" style="background:${COLORS[k]}"></i>${LABELS[k]}${estimate?' <small>förslag</small>':''}</span><span>${fmt(length/1000,1)} km <small>· ${fmt(100*length/r.distance)} %</small></span></div>`;}).join('');
 $('surface-warning').hidden=r.surface_status!=='failed';$('surface-warning').textContent=r.surface_status==='failed'?'Rutten är sparad, men underlagen kunde inte hämtas. '+(r.surface_error||'')+' Du kan försöka igen under Redigera rutt → Kartförslag.':'';const diag=r.surface_diagnostics;$('osm-status').textContent=diag?`${diag.geometry_ways} kartlagda vägar hämtades. ${diag.matched_percent} % av spåret matchade en väg; ${diag.classified_percent} % kunde klassificeras före manuella ändringar.`:'';
 $('cafe-count').textContent=r.cafes.length?`(${r.cafes.length})`:'';
 $('cafes').innerHTML=r.cafes.length?r.cafes.slice().sort((a,b)=>a.distance-b.distance).map(c=>`<div class="cafe-item"><button class="locate" data-cafe="${c.id}">☕ ${esc(c.name)} ↗</button><p>${esc(c.note)}</p><span class="distance">Nära ${fmt(c.distance/1000,1)} km från start</span>${state.admin?` <button class="text-button" data-remove-cafe="${c.id}">Ta bort</button>`:''}</div>`).join(''):'<p class="muted small">Inga fikastopp tillagda ännu.</p>';
 $('edit').hidden=!state.admin;for(const name of ['name','location','category','description','source_url'])$('meta-form').elements[name].value=r[name];
 for(const key of ['is_race_course','is_strava_segment'])$('meta-form').elements[key].checked=!!r[key];
 $('to-km').value=String(r.distance/1000);$('from-km').max=$('to-km').max=String(r.distance/1000);
 if(!detailMap){detailMap=newMap('route-map','detail-message');routeLayers=L.layerGroup().addTo(detailMap);detailMap.on('click',pickOnMap);}routeLayers.clearLayers();drawRoute(detailMap,routeLayers,r);
 r.cafes.forEach(c=>{const content=document.createElement('div');const title=document.createElement('strong');title.textContent=c.name;content.append(title);if(c.note){const note=document.createElement('p');note.textContent=c.note;content.append(note);}L.marker([c.lat,c.lon],{icon:L.divIcon({className:'cafe-marker',html:'☕',iconSize:[32,32],iconAnchor:[16,16]})}).bindPopup(content).addTo(routeLayers);});
 requestAnimationFrame(()=>{detailMap.invalidateSize();if(refit)fit(detailMap,r.points);});renderChart(r);
}
async function navigate(path,push=true){
 const ticket=++state.nav;if(push)history.pushState({},'',path);cleanPreviews();state.pick=null;state.cafe=null;state.selection=[];clearSelection();$('editor').hidden=true;$('map-hint').textContent='⊕ RUTTEN';
 const match=path.match(/^\/rutt\/([a-f0-9]{16})\/?$/);
 if(match){$('library').hidden=true;$('detail').hidden=false;$('route-name').textContent='Hämtar rutten…';try{const r=await api('/api/routes/'+match[1]);if(ticket!==state.nav)return;renderDetail(r);}catch(e){toast(e.message,true);navigate('/',true);}}
 else{$('detail').hidden=true;$('library').hidden=false;document.title='Alvins Ruttbank';await loadLibrary().catch(e=>toast(e.message,true));if(overview)requestAnimationFrame(()=>{overview.invalidateSize();renderLibrary();});}
 window.scrollTo({top:0,behavior:'instant'});
}
function requireAdmin(next){if(state.admin)return next();state.afterLogin=next;$('login-error').textContent='';$('login-dialog').showModal();}
function requestUpload(){requireAdmin(()=>{$('upload-error').textContent='';$('upload-dialog').showModal();});}
function fileChanged(){const f=$('file').files[0];$('file-label').textContent=f?'✓ '+f.name:'Välj eller dra in en GPX-fil';$('file-meta').textContent=f?fmt(f.size/1024/1024,2)+' MB · redo att importera':'Högst 20 MB · spår och rutter stöds';}
function clearSelection(){if(selectionLayer&&detailMap)detailMap.removeLayer(selectionLayer);selectionLayer=null;if(hoverMarker&&detailMap)detailMap.removeLayer(hoverMarker);hoverMarker=null;}
function pickOnMap(e){
 if(!state.pick||!state.route)return;
 if(state.pick==='cafe'){state.cafe={lat:e.latlng.lat,lon:e.latlng.lng};$('cafe-position').textContent=`Plats vald: ${fmt(e.latlng.lat,5)}, ${fmt(e.latlng.lng,5)}`;clearSelection();selectionLayer=L.marker(e.latlng,{icon:icon('☕')}).addTo(detailMap);state.pick=null;$('map-hint').textContent='Plats vald. Spara fikastoppet nedanför kartan.';$('cafe-form').scrollIntoView({behavior:'smooth',block:'center'});return;}
 let closest=state.route.points[0],best=Infinity;const cos=Math.cos(e.latlng.lat*Math.PI/180);for(const p of state.route.points){const d=(p[0]-e.latlng.lat)**2+((p[1]-e.latlng.lng)*cos)**2;if(d<best){best=d;closest=p;}}
 state.selection.push(closest[3]);if(!selectionLayer)selectionLayer=L.layerGroup().addTo(detailMap);L.circleMarker(closest.slice(0,2),{radius:8,color:'#fff',fillColor:'#b5ef63',fillOpacity:1}).addTo(selectionLayer);
 if(state.selection.length===1){$('from-km').value=String(closest[3]/1000);$('map-hint').textContent='Välj sträckans andra punkt på kartan.';}
 else{state.selection.sort((a,b)=>a-b);$('from-km').value=String(state.selection[0]/1000);$('to-km').value=String(state.selection[1]/1000);state.pick=null;$('map-hint').textContent='Sträcka vald. Välj underlag och spara nedanför.';$('surface-form').scrollIntoView({behavior:'smooth',block:'center'});}
}
async function mutate(data,button){if(button)button.disabled=true;try{const r=await api('/api/routes/'+state.route.id,{method:'PATCH',body:{...data,revision:state.route.revision}});renderDetail(r,false);clearSelection();toast('Ändringen är sparad.');return true;}catch(e){toast(e.message,true);return false;}finally{if(button)button.disabled=false;}}
document.addEventListener('click',e=>{const close=e.target.closest('[data-close]');if(close)$(close.dataset.close).close();const a=e.target.closest('a[href]');if(a&&a.origin===location.origin&&(a.pathname==='/'||a.pathname.startsWith('/rutt/'))&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&e.button===0){e.preventDefault();navigate(a.pathname);}});
window.addEventListener('popstate',()=>navigate(location.pathname,false));
$('upload').onclick=requestUpload;
function stopNearby(){
 state.nearby=false;state.locationRequest++;const button=$('locate');button.disabled=false;button.textContent='Nära mig';button.classList.remove('active');button.setAttribute('aria-pressed','false');button.removeAttribute('aria-busy');$('location-status').hidden=true;
}
function activateNearby(){
 if(state.nearby){stopNearby();renderLibrary();return;}
 const button=$('locate'),status=$('location-status');status.hidden=false;
 const showError=message=>{button.disabled=false;button.textContent='Nära mig';button.removeAttribute('aria-busy');status.textContent=message;toast(message,true);};
 if(!navigator.geolocation){showError('Platsåtkomst saknas. Använd HTTPS eller localhost och aktivera platstjänster.');return;}
 const ticket=++state.locationRequest;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='Söker plats…';status.textContent='Tillåt platsåtkomst i webbläsaren. Söker din nuvarande position…';
 navigator.geolocation.getCurrentPosition(result=>{
  if(ticket!==state.locationRequest)return;
  state.position={latitude:result.coords.latitude,longitude:result.coords.longitude};state.nearby=true;
  button.disabled=false;button.textContent='Nära mig';button.removeAttribute('aria-busy');button.classList.add('active');button.setAttribute('aria-pressed','true');
  status.textContent='Närmaste start först · avstånd fågelvägen.'+(result.coords.accuracy>1000?' Din position är ungefärlig.':'');state.limit=8;renderLibrary();
 },error=>{if(ticket!==state.locationRequest)return;showError(error.code===1?'Platsåtkomst nekades. Tillåt plats för webbplatsen och aktivera platstjänster i Windows eller mobilen.':error.code===3?'Positionen kunde inte hittas inom 20 sekunder. Kontrollera platstjänster och försök igen.':'Din position kunde inte hämtas. Kontrollera platstjänster och försök igen.');},{enableHighAccuracy:true,timeout:20000,maximumAge:0});
}
$('locate').onclick=activateNearby;
$('admin').onclick=()=>{if(!state.admin)return requireAdmin(()=>toast('Du är inloggad.'));api('/api/logout',{method:'POST',body:{}}).then(()=>{state.admin=false;$('admin').textContent='Administrera';$('edit').hidden=true;$('editor').hidden=true;if(state.route)renderDetail(state.route,false);toast('Du är utloggad.');}).catch(e=>toast(e.message,true));};
$('login-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{await api('/api/login',{method:'POST',body:{password:e.target.elements.password.value}});state.admin=true;$('admin').textContent='Logga ut';$('login-dialog').close();e.target.reset();if(state.route){$('edit').hidden=false;renderDetail(state.route,false);}const next=state.afterLogin;state.afterLogin=null;next?.();}catch(err){$('login-error').textContent=err.message;}finally{button.disabled=false;}};
$('file').onchange=fileChanged;
['dragenter','dragover'].forEach(type=>$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.add('drag');}));
['dragleave','drop'].forEach(type=>$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.remove('drag');}));
$('dropzone').addEventListener('drop',e=>{if(e.dataTransfer.files.length){const transfer=new DataTransfer();transfer.items.add(e.dataTransfer.files[0]);$('file').files=transfer.files;fileChanged();}});
$('upload-form').onsubmit=async e=>{e.preventDefault();const f=$('file').files[0];if(!f)return;if(!f.name.toLowerCase().endsWith('.gpx')||f.size>20*1024*1024){$('upload-error').textContent='Välj en GPX-fil på högst 20 MB.';return;}const button=$('upload-submit');button.disabled=true;button.textContent='Importerar och hämtar underlag…';$('upload-progress').textContent='Hämtar underlag från kartan. Det kan ta upp till en minut, eller längre om en annan import pågår.';$('upload-error').textContent='';try{const form=new FormData(e.target);form.set('file',f);const r=await api('/api/routes',{method:'POST',body:form});$('upload-dialog').close();e.target.reset();fileChanged();await navigate('/rutt/'+r.id);toast(r.surface_status==='failed'?'Rutten är sparad, men underlagen kunde inte hämtas. Se meddelandet på ruttsidan.':'Rutten och underlagsanalysen är sparade.',r.surface_status==='failed');}catch(err){$('upload-error').textContent=err.message;}finally{button.disabled=false;button.textContent='Importera rutt';$('upload-progress').textContent='';}};
let searchTimer;$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.limit=8;renderLibrary();},150);};
['length','sort','cafe-filter','surface-filter','race-filter','segment-filter'].forEach(id=>$(id).onchange=()=>{if(id==='sort')stopNearby();state.limit=8;renderLibrary();});
$('categories').onclick=e=>{const b=e.target.closest('[data-category]');if(b)setCategory(b.dataset.category);};$('clear').onclick=clearFilters;$('more').onclick=()=>{state.limit+=8;renderLibrary();};
$('fit-overview').onclick=()=>fit(overview,filtered().slice(0,100).flatMap(r=>r.preview));$('fit-detail').onclick=()=>fit(detailMap,state.route.points);
$('edit').onclick=()=>{$('editor').hidden=false;$('editor').scrollIntoView({behavior:'smooth',block:'start'});};$('close-editor').onclick=()=>{$('editor').hidden=true;state.pick=null;clearSelection();$('map-hint').textContent='⊕ RUTTEN';};
$('meta-form').onsubmit=e=>{e.preventDefault();mutate({action:'metadata',...Object.fromEntries(new FormData(e.target))},e.submitter);};
$('surface-form').onsubmit=e=>{e.preventDefault();mutate({action:'surface',start:Number($('from-km').value)*1000,end:Number($('to-km').value)*1000,kind:$('surface-kind').value},e.submitter);};
$('all-surface').onclick=()=>{$('from-km').value=0;$('to-km').value=state.route.distance/1000;};
$('pick-surface').onclick=()=>{clearSelection();state.pick='surface';state.selection=[];$('map-hint').textContent='Välj sträckans första punkt på rutten.';$('route-map').scrollIntoView({behavior:'smooth',block:'center'});};
$('pick-cafe').onclick=()=>{clearSelection();state.pick='cafe';$('map-hint').textContent='Klicka där fikastoppet ligger.';$('route-map').scrollIntoView({behavior:'smooth',block:'center'});};
$('cafe-form').onsubmit=async e=>{e.preventDefault();if(!state.cafe)return toast('Placera fikastoppet på kartan först.',true);if(await mutate({action:'cafe',...state.cafe,...Object.fromEntries(new FormData(e.target))},e.submitter)){e.target.reset();state.cafe=null;$('cafe-position').textContent='Ingen plats vald.';}};
$('cafes').onclick=e=>{const locate=e.target.closest('[data-cafe]'),remove=e.target.closest('[data-remove-cafe]');if(locate){const c=state.route.cafes.find(c=>c.id===locate.dataset.cafe);detailMap.setView([c.lat,c.lon],16);$('route-map').scrollIntoView({behavior:'smooth',block:'center'});}if(remove&&confirm('Ta bort det här fikastoppet?'))mutate({action:'remove_cafe',cafe_id:remove.dataset.removeCafe},remove);};
$('suggest').onclick=async()=>{const button=$('suggest');button.disabled=true;$('osm-status').textContent='Hämtar kartdata och jämför med spåret…';const key=state.route.id;try{const r=await api('/api/routes/'+key+'/suggest-surfaces',{method:'POST',body:{revision:state.route.revision}});if(state.route?.id===key){renderDetail(r,false);if(r.surface_diagnostics?.classified_percent===0)$('osm-status').textContent+=' Inget tillförlitligt underlag hittades. Kontrollera manuellt; grått är inte en uppgift om vägtypen.';}toast('Karthämtningen är klar. Se resultatet under Kartförslag.');}catch(e){$('osm-status').textContent=e.message;toast(e.message,true);}finally{button.disabled=false;}};
$('delete-route').onclick=async()=>{if(!confirm('Radera den här rutten och dess fikastopp? Detta går inte att ångra.'))return;try{await api('/api/routes/'+state.route.id,{method:'DELETE',body:{}});state.route=null;await navigate('/');toast('Rutten har raderats.');}catch(e){toast(e.message,true);}};
async function init(){try{Object.assign(state,await api('/api/session'));$('admin').textContent=state.admin?'Logga ut':'Administrera';if(typeof L==='undefined')throw Error('Kartbiblioteket saknas. Packa upp hela projektmappen på nytt.');overview=newMap('overview','overview-message');overviewLayers=L.layerGroup().addTo(overview);await navigate(location.pathname,false);}catch(e){$('results').textContent='Kunde inte ladda ruttbanken';toast(e.message,true);}}
init();
