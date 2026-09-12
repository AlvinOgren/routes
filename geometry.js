import {XMLParser, XMLValidator} from 'fast-xml-parser';
export const SURFACES=['unknown','asphalt','gravel','trail'];
export const num=value=>{if(value===null||value===undefined||value==='')throw Error('Ange ett giltigt tal.');const n=Number(value);if(!Number.isFinite(n))throw Error('Ange ett giltigt tal.');return n;};
export function distance(a,b){const rad=Math.PI/180,h=Math.sin((b[0]-a[0])*rad/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin((b[1]-a[1])*rad/2)**2;return 6371008.8*2*Math.asin(Math.min(1,Math.sqrt(h)));}
const arr=x=>x===undefined?[]:Array.isArray(x)?x:[x];
export function parseGPX(raw){
 const xml=raw.toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error('Filen kunde inte läsas som GPX. Exportera den på nytt.');
 const tree=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,processEntities:true}).parse(xml);
 if(!tree.gpx)throw Error('Det här är inte en GPX-fil.');
 const tracks=arr(tree.gpx.trk),routes=arr(tree.gpx.rte);let groups=tracks.flatMap(t=>arr(t.trkseg).map(s=>arr(s.trkpt)));if(!groups.length)groups=routes.map(r=>arr(r.rtept));
 const points=[];let total=0,gain=0,loss=0,known=0,edges=0;
 groups.forEach((group,segment)=>{let prev=null,anchor=null;for(const el of group){const lat=num(el['@_lat']),lon=num(el['@_lon']);if(Math.abs(lat)>90||Math.abs(lon)>180)throw Error('Ogiltiga koordinater.');const ele=el.ele===undefined?null:num(el.ele);const p=[lat,lon,ele,0,segment];if(prev){total+=distance(prev,p);edges++;if(prev[2]!==null&&ele!==null)known++;}p[3]=Math.round(total*1000)/1000;points.push(p);if(ele===null)anchor=null;else if(anchor===null)anchor=ele;else if(Math.abs(ele-anchor)>=3){gain+=Math.max(0,ele-anchor);loss+=Math.max(0,anchor-ele);anchor=ele;}prev=p;if(points.length>60000)throw Error('Filen har fler än 60 000 punkter. Förenkla GPX-spåret först.');}});
 if(points.length<2||total<1)throw Error('Filen behöver minst två olika spårpunkter.');
 const heights=points.filter(p=>p[2]!==null).map(p=>p[2]);
 return {points,distance:Math.round(total*1000)/1000,ascent:known?Math.round(gain):null,descent:known?Math.round(loss):null,elevation_coverage:Math.round(known/Math.max(1,edges)*1000)/1000,min_elevation:heights.length?Math.min(...heights):null,max_elevation:heights.length?Math.max(...heights):null,gpx_name:String(tracks[0]?.name??routes[0]?.name??'').slice(0,120),segments:new Set(points.map(p=>p[4])).size};
}
export function paint(spans,start,end,kind,total,source='manual'){
 start=num(start);end=num(end);if(!SURFACES.includes(kind)||start<0||start>=end||end>total+.01)throw Error('Välj ett intervall inom rutten och ett giltigt underlag.');end=Math.min(end,total);const result=[];
 for(const s of spans){if(s.end<=start||s.start>=end)result.push({...s});else{if(s.start<start)result.push({...s,end:start});result.push({start:Math.max(start,s.start),end:Math.min(end,s.end),kind,source});if(s.end>end)result.push({...s,start:end});}}
 const merged=[];for(const s of result){const last=merged.at(-1);if(last&&last.kind===s.kind&&last.source===s.source)last.end=s.end;else merged.push(s);}return merged;
}
export function sample(points,limit=220){const step=Math.max(1,Math.ceil(points.length/limit)),chosen=new Set([0,points.length-1]);for(let i=0;i<points.length;i+=step)chosen.add(i);for(let i=1;i<points.length;i++)if(points[i][4]!==points[i-1][4]){chosen.add(i-1);chosen.add(i);}return [...chosen].sort((a,b)=>a-b).map(i=>points[i]);}
const escapeXML=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function exportGPX(r){let xml='<?xml version="1.0" encoding="UTF-8"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="Alvins Ruttbank">';for(const c of r.cafes)xml+=`<wpt lat="${c.lat}" lon="${c.lon}"><name>${escapeXML(c.name)}</name><desc>${escapeXML(c.note)}</desc></wpt>`;xml+=`<trk><name>${escapeXML(r.name)}</name><desc>${escapeXML(r.description)}</desc>`;let old=null;for(const [lat,lon,ele,,seg] of r.points){if(seg!==old){if(old!==null)xml+='</trkseg>';xml+='<trkseg>';old=seg;}xml+=`<trkpt lat="${lat}" lon="${lon}">${ele!==null?`<ele>${ele}</ele>`:''}</trkpt>`;}return xml+'</trkseg></trk></gpx>';}
