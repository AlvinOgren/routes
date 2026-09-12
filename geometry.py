"""GPX parsing, distance, elevation and surface interval operations."""
import math
from bisect import bisect_right
from defusedxml import ElementTree as SafeET
from xml.etree import ElementTree as ET

SURFACES = ('unknown', 'asphalt', 'gravel', 'trail', 'other')

def number(value):
    try:
        n = float(value)
    except (ValueError, TypeError):
        raise ValueError('Ange ett giltigt tal.')
    if not math.isfinite(n):
        raise ValueError('Ogiltigt tal i filen.')
    return n

def distance(a, b):
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlat, dlon = lat2-lat1, math.radians(b[1]-a[1])
    h = math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 6371008.8*2*math.asin(min(1, math.sqrt(h)))

def parse_gpx(raw):
    try:
        root = SafeET.fromstring(raw)
    except Exception:
        raise ValueError('Filen kunde inte läsas som GPX. Exportera den på nytt och försök igen.')
    if root.tag.split('}')[-1] != 'gpx':
        raise ValueError('Det här är inte en GPX-fil.')
    groups = root.findall('.//{*}trkseg')
    if not groups:
        groups = root.findall('./{*}rte')
    points, total, gain, loss = [], 0., 0., 0.
    known_edges = 0
    for segment, group in enumerate(groups):
        prev, anchor = None, None
        nodes = [p for p in group if p.tag.split('}')[-1] in ('trkpt','rtept')]
        for el in nodes:
            try:
                lat, lon = number(el.attrib['lat']), number(el.attrib['lon'])
                if not -90 <= lat <= 90 or not -180 <= lon <= 180:
                    raise ValueError()
                elev = el.find('{*}ele')
                height = number(elev.text) if elev is not None and elev.text else None
            except (KeyError, ValueError, TypeError):
                raise ValueError('GPX-filen innehåller ogiltiga koordinater eller höjdvärden.')
            p = [lat, lon, height, 0., segment]
            if prev:
                total += distance(prev, p)
                if prev[2] is not None and height is not None:
                    known_edges += 1
            p[3] = round(total, 3)
            points.append(p)
            if height is None:
                anchor = None
            elif anchor is None:
                anchor = height
            elif abs(height-anchor) >= 3:
                gain += max(0, height-anchor)
                loss += max(0, anchor-height)
                anchor = height
            prev = p
            if len(points) > 60000:
                raise ValueError('Filen har fler än 60 000 punkter. Förenkla GPX-spåret först.')
    if len(points) < 2 or total < 1:
        raise ValueError('Filen behöver ett spår eller en rutt med minst två olika punkter.')
    label = root.find('.//{*}trk/{*}name')
    if label is None:
        label = root.find('.//{*}rte/{*}name')
    heights = [p[2] for p in points if p[2] is not None]
    edge_count = sum(a[4] == b[4] for a,b in zip(points, points[1:]))
    return {'points': points, 'distance': round(total, 3),
            'ascent': round(gain) if known_edges else None,
            'descent': round(loss) if known_edges else None,
            'elevation_coverage': round(known_edges/max(1, edge_count), 3),
            'min_elevation': min(heights) if heights else None,
            'max_elevation': max(heights) if heights else None,
            'gpx_name': (label.text or '').strip()[:120] if label is not None else '',
            'segments': len(set(p[4] for p in points))}

def paint(spans, start, end, kind, total, source='manual'):
    start, end = number(start), number(end)
    if kind not in SURFACES or not 0 <= start < end <= total+.01:
        raise ValueError('Välj ett giltigt underlag och ett intervall inom rutten.')
    end = min(end, total)
    result = []
    for span in spans:
        a,b = span['start'],span['end']
        if b <= start or a >= end:
            result.append(span.copy())
        else:
            if a < start: result.append({**span,'end':start})
            result.append({'start':max(a,start),'end':min(b,end),'kind':kind,'source':source})
            if b > end: result.append({**span,'start':end})
    merged=[]
    for span in result:
        if merged and merged[-1]['kind']==span['kind'] and merged[-1]['source']==span['source']:
            merged[-1]['end']=span['end']
        else: merged.append(span)
    return merged

def sample(points, limit=220):
    step=max(1,math.ceil(len(points)/limit))
    chosen={0,len(points)-1,*range(0,len(points),step)}
    for i in range(1,len(points)):
        if points[i][4]!=points[i-1][4]:chosen.update((i-1,i))
    return [points[i] for i in sorted(chosen)]

def export_gpx(route):
    ns='http://www.topografix.com/GPX/1/1'
    ET.register_namespace('',ns)
    root=ET.Element('{'+ns+'}gpx',version='1.1',creator='Alvins Ruttbank')
    track=ET.SubElement(root,'{'+ns+'}trk')
    ET.SubElement(track,'{'+ns+'}name').text=route['name']
    ET.SubElement(track,'{'+ns+'}desc').text=route['description']
    old=None
    for lat,lon,ele,_,seg in route['points']:
        if old!=seg:
            group=ET.SubElement(track,'{'+ns+'}trkseg');old=seg
        p=ET.SubElement(group,'{'+ns+'}trkpt',lat=str(lat),lon=str(lon))
        if ele is not None: ET.SubElement(p,'{'+ns+'}ele').text=str(ele)
    # GPX schema requires waypoints before tracks.
    for cafe in reversed(route.get('cafes',[])):
        p=ET.Element('{'+ns+'}wpt',lat=str(cafe['lat']),lon=str(cafe['lon']))
        ET.SubElement(p,'{'+ns+'}name').text=cafe['name']
        ET.SubElement(p,'{'+ns+'}desc').text=cafe.get('note','')
        root.insert(0,p)
    return ET.tostring(root,encoding='utf-8',xml_declaration=True)
