import {distance} from './geometry.js';
export function classify(tags={}){
 const s=String(tags.surface||'').toLowerCase().trim();
 if(s==='asphalt')return {kind:'asphalt',source:'osm'};
 if(['gravel','fine_gravel','compacted','pebblestone'].includes(s))return {kind:'gravel',source:'osm'};
 if(['concrete','concrete:plates','concrete:lanes','paving_stones','sett','cobblestone','wood'].includes(s))return {kind:'gravel',source:'osm'};
 if(s==='paved')return {kind:'gravel',source:'osm'};
 if(['path','bridleway','footway'].includes(tags.highway)&&(!s||['ground','dirt','earth','grass','mud','rock','unpaved','sand'].includes(s)))return {kind:'trail',source:s?'osm':'osm-inferred'};
 if(['unpaved','ground','dirt','earth','grass','mud','sand'].includes(s))return {kind:'gravel',source:'osm'};
 if(!s&&tags.tracktype==='grade2')return {kind:'gravel',source:'osm-inferred'};
 return {kind:'unknown',source:'unknown'};
}
export function infer(points,elements){
 const lat0=points.reduce((s,p)=>s+p[0],0)/points.length,sx=111320*Math.max(.1,Math.cos(lat0*Math.PI/180));
 const xy=p=>[p[1]*sx,p[0]*111320];const grid=new Map();let refs=0,geometryWays=0,taggedWays=0;
 for(const way of elements){const geo=way.geometry||[];if(geo.length<2)continue;geometryWays++;const cls=classify(way.tags);if(cls.kind!=='unknown')taggedWays++;
  for(let i=1;i<geo.length;i++){const a=geo[i-1],b=geo[i];if(!a||!b)continue;const [ax,ay]=xy([a.lat,a.lon]),[bx,by]=xy([b.lat,b.lon]);if(Math.hypot(bx-ax,by-ay)>2000)continue;
   const edge={ax,ay,bx,by,...cls};for(let x=Math.floor(Math.min(ax,bx)/60);x<=Math.floor(Math.max(ax,bx)/60);x++)for(let y=Math.floor(Math.min(ay,by)/60);y<=Math.floor(Math.max(ay,by)/60);y++){const key=x+','+y;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(edge);if(++refs>800000)throw Error('Kartområdet är för stort för matchning. Markera underlag manuellt.');}
  }
 }
 if(elements.length&&!geometryWays)throw Error('Karttjänsten returnerade vägar utan geometri. Inga underlag ändrades.');
 const spans=[];let near=0,known=0;
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(a[4]!==b[4]||b[3]<=a[3])continue;const n=Math.max(1,Math.ceil((b[3]-a[3])/25));
  for(let j=0;j<n;j++){const t=(j+.5)/n,[x,y]=xy([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]),candidates=new Map();const gx=Math.floor(x/60),gy=Math.floor(y/60);
   for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const e of grid.get((gx+dx)+','+(gy+dy))||[]){const vx=e.bx-e.ax,vy=e.by-e.ay,f=Math.max(0,Math.min(1,((x-e.ax)*vx+(y-e.ay)*vy)/Math.max(.0001,vx*vx+vy*vy))),d=Math.hypot(x-e.ax-f*vx,y-e.ay-f*vy);if(d<=30&&d<(candidates.get(e.kind)?.d??Infinity))candidates.set(e.kind,{...e,d});}
   const ranked=[...candidates.values()].sort((a,b)=>a.d-b.d);const len=(b[3]-a[3])/n;if(ranked.length)near+=len;
   const c=ranked.length&&(ranked.length===1||ranked[1].d-ranked[0].d>5)?ranked[0]:{kind:'unknown',source:'unknown'};
   if(c.kind!=='unknown')known+=len;const start=a[3]+len*j,end=a[3]+len*(j+1),last=spans.at(-1);if(last&&last.kind===c.kind&&last.source===c.source)last.end=end;else spans.push({start,end,kind:c.kind,source:c.source});
  }
 }
 return {spans,diagnostics:{ways:elements.length,geometry_ways:geometryWays,classified_ways:taggedWays,matched_percent:Math.round(near/points.at(-1)[3]*100),classified_percent:Math.round(known/points.at(-1)[3]*100),checked_at:new Date().toISOString()}};
}
export async function fetchSuggestions(points,fetcher=fetch){
 const south=Math.min(...points.map(p=>p[0]))-.001,north=Math.max(...points.map(p=>p[0]))+.001,west=Math.min(...points.map(p=>p[1]))-.002,east=Math.max(...points.map(p=>p[1]))+.002;
 const area=distance([south,west],[north,west])*distance([south,west],[south,east])/1e6;
 if(area>1200||points.at(-1)[3]>200000)throw Error('Kartförslag stöder högst 200 km och ett kartområde på 1 200 km². Markera denna rutt manuellt.');
 // Do not filter out roads without surface: path/track tags can add information,
 // and unknown parallel roads must participate to avoid false assignments.
 const query=`[out:json][timeout:30][maxsize:33554432];way["highway"](${south},${west},${north},${east});out body geom;`;
 let data;
 try{const res=await fetcher('https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:query}),headers:{'User-Agent':'AlvinsRuttbank/2.0'},signal:AbortSignal.timeout(45000)});if(!res.ok)throw Error();const reader=res.body.getReader();let bytes=0;const chunks=[];while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>16*1024*1024){await reader.cancel();throw Error();}chunks.push(value);}data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(data.remark||!Array.isArray(data.elements))throw Error();}
 catch{throw Error('Karttjänsten kunde inte svara just nu. Inga underlag ändrades. Försök senare.');}
 return infer(points,data.elements);
}
