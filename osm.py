"""Optional conservative surface suggestions from OpenStreetMap / Overpass."""
import json
import math
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from geometry import distance

def kind(tags):
    surface=tags.get('surface','')
    if surface=='asphalt':return 'asphalt'
    if tags.get('highway') in ('path','bridleway') and surface in ('ground','dirt','earth','grass','mud','rock'):
        return 'trail'
    if surface in ('gravel','fine_gravel','compacted','pebblestone'):return 'gravel'
    if surface in ('concrete','concrete:plates','paving_stones','sett','cobblestone','wood'):return 'other'
    return 'unknown'

def infer(points, elements):
    lat0=sum(p[0] for p in points)/len(points)
    sx=111320*max(.1,math.cos(math.radians(lat0)))
    def xy(p):return p[1]*sx,p[0]*111320
    grid={};edge_count=0
    for way in elements:
        geo=way.get('geometry',[]);k=kind(way.get('tags',{}))
        if k=='unknown':continue
        for a,b in zip(geo,geo[1:]):
            ax,ay=xy([a['lat'],a['lon']]);bx,by=xy([b['lat'],b['lon']])
            if math.hypot(bx-ax,by-ay)>1000:continue
            edge=(ax,ay,bx,by,k)
            for x in range(math.floor(min(ax,bx)/50),math.floor(max(ax,bx)/50)+1):
                for y in range(math.floor(min(ay,by)/50),math.floor(max(ay,by)/50)+1):
                    grid.setdefault((x,y),[]).append(edge)
                    edge_count+=1
                    if edge_count>500000:raise ValueError('Kartområdet innehåller för mycket data. Markera underlag manuellt.')
    spans=[]
    for a,b in zip(points,points[1:]):
        if a[4]!=b[4] or b[3]<=a[3]:continue
        n=max(1,math.ceil((b[3]-a[3])/35))
        for i in range(n):
            t=(i+.5)/n
            x,y=xy([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t])
            candidates={}
            gx,gy=math.floor(x/50),math.floor(y/50)
            for dx in (-1,0,1):
                for dy in (-1,0,1):
                    for ax,ay,bx,by,k in grid.get((gx+dx,gy+dy),[]):
                        vx,vy=bx-ax,by-ay
                        f=max(0,min(1,((x-ax)*vx+(y-ay)*vy)/max(.0001,vx*vx+vy*vy)))
                        d=math.hypot(x-ax-f*vx,y-ay-f*vy)
                        if d<=18:candidates[k]=min(d,candidates.get(k,999))
            ranked=sorted(candidates.items(),key=lambda v:v[1])
            k=ranked[0][0] if ranked and (len(ranked)==1 or ranked[1][1]-ranked[0][1]>6) else 'unknown'
            start=a[3]+(b[3]-a[3])*i/n;end=a[3]+(b[3]-a[3])*(i+1)/n
            if spans and spans[-1]['kind']==k:spans[-1]['end']=end
            else:spans.append({'start':start,'end':end,'kind':k,'source':'osm' if k!='unknown' else 'unknown'})
    return spans

def fetch_suggestions(points):
    south,north=min(p[0] for p in points)-.001,max(p[0] for p in points)+.001
    west,east=min(p[1] for p in points)-.002,max(p[1] for p in points)+.002
    area=distance([south,west],[north,west])*distance([south,west],[south,east])/1e6
    if area>1200 or points[-1][3]>200000:
        raise ValueError('Automatiska förslag stöder rutter upp till 200 km i ett kartområde på högst 1 200 km². Markera underlag manuellt för denna rutt.')
    query=f'[out:json][timeout:30][maxsize:33554432];way["highway"]["surface"]({south},{west},{north},{east});out tags geom;'
    request=Request('https://overpass-api.de/api/interpreter',data=urlencode({'data':query}).encode(),
                    headers={'User-Agent':'AlvinsRuttbank/1.0','Content-Type':'application/x-www-form-urlencoded'})
    try:
        with urlopen(request,timeout=40) as response:
            raw=response.read(12*1024*1024+1)
        if len(raw)>12*1024*1024:raise ValueError()
        data=json.loads(raw)
        if data.get('remark'):raise ValueError()
    except Exception:
        raise ValueError('Karttjänsten kunde inte svara just nu. Inga underlag har ändrats. Försök senare eller markera manuellt.')
    return infer(points,data.get('elements',[]))
