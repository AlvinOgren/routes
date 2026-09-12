import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from urllib.parse import urlparse
from functools import wraps
from flask import Flask, request, session, jsonify, send_file, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
from geometry import parse_gpx, paint, sample, export_gpx, number, SURFACES

ROOT=Path(__file__).resolve().parent
CATEGORIES=('gravel','road','mtb','mixed')

def create_app(data_dir=None, password=None, public_url=''):
    data=Path(data_dir or ROOT/'data');data.mkdir(parents=True,exist_ok=True)
    config_file=data/'config.json'
    if config_file.exists():config=json.loads(config_file.read_text('utf-8'))
    else:
        config={'secret':secrets.token_hex(32),'admin_code':secrets.token_urlsafe(12)}
        config_file.write_text(json.dumps(config),encoding='utf-8')
    app=Flask(__name__,static_folder=None)
    hosts={'localhost','127.0.0.1'}
    if public_url:
        u=urlparse(public_url)
        if u.scheme!='https' or not u.hostname or u.path not in ('','/'):
            raise ValueError('PUBLIC_URL måste vara en HTTPS-adress utan sökväg.')
        hosts.add(u.hostname)
    app.config.update(SECRET_KEY=config['secret'],MAX_CONTENT_LENGTH=21*1024*1024,
                      SESSION_COOKIE_HTTPONLY=True,SESSION_COOKIE_SAMESITE='Strict',
                      SESSION_COOKIE_SECURE=bool(public_url),TRUSTED_HOSTS=list(hosts))
    admin_code=password or os.environ.get('ADMIN_PASSWORD') or config['admin_code']
    app.config['ADMIN_CODE']=admin_code
    password_hash=generate_password_hash(admin_code)
    dbpath=data/'routes.sqlite3'
    def db():
        con=sqlite3.connect(dbpath,timeout=15);con.row_factory=sqlite3.Row
        return con
    with db() as con:
        con.execute('CREATE TABLE IF NOT EXISTS routes (id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE, payload TEXT NOT NULL)')
    con.close()
    lock=threading.Lock();attempts=[];osm_lock=threading.Lock();osm_last=[0.]
    def load(key):
        con=db()
        try:row=con.execute('SELECT payload FROM routes WHERE id=?',(key,)).fetchone()
        finally:con.close()
        if not row:raise LookupError('Rutten finns inte längre.')
        return json.loads(row['payload'])
    def save(route):
        route['revision']+=1;route['updated']=int(time.time())
        con=db()
        try:
            with con:con.execute('UPDATE routes SET payload=? WHERE id=?',(json.dumps(route),route['id']))
        finally:con.close()
    def admin(fn):
        @wraps(fn)
        def wrapped(*a,**k):
            if not session.get('admin'):return jsonify(error='Logga in för att ändra ruttbanken.'),401
            return fn(*a,**k)
        return wrapped
    def body():
        value=request.get_json(silent=True)
        if not isinstance(value,dict):raise ValueError('Ogiltig begäran.')
        return value
    def text(value,maximum,required=False):
        if not isinstance(value,str):raise ValueError('Ett textfält har fel format.')
        value=value.strip()
        if len(value)>maximum or (required and not value):raise ValueError('Kontrollera textfältens längd och ruttnamnet.')
        return value
    def metadata(b):
        category=b.get('category','mixed')
        if category not in CATEGORIES:raise ValueError('Välj en ruttyp.')
        url=text(b.get('source_url',''),500)
        if url and (urlparse(url).scheme not in ('http','https') or not urlparse(url).hostname):
            raise ValueError('Länken måste börja med https:// eller http://.')
        return {'name':text(b.get('name',''),120,True),'description':text(b.get('description',''),4000),
                'location':text(b.get('location',''),120),'category':category,'source_url':url}
    def summary(r):
        v={k:value for k,value in r.items() if k not in ('points','cafes','gpx_name')}
        v['preview']=sample(r['points']);v['cafe_count']=len(r['cafes'])
        v['surface_totals']={k:sum(s['end']-s['start'] for s in r['surfaces'] if s['kind']==k) for k in SURFACES}
        return v
    @app.before_request
    def csrf_check():
        if request.method in ('POST','PATCH','DELETE'):
            token=session.get('csrf')
            if not token or not secrets.compare_digest(request.headers.get('X-CSRF-Token',''),token):
                return jsonify(error='Sessionen har gått ut. Ladda om sidan.'),403
            origin=request.headers.get('Origin')
            if origin and urlparse(origin).netloc!=request.host:return jsonify(error='Otillåten begäran.'),403
    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='strict-origin-when-cross-origin'
        response.headers['X-Frame-Options']='DENY'
        if request.path.startswith('/api/'):response.headers['Cache-Control']='no-store'
        return response
    @app.errorhandler(ValueError)
    def invalid(e):return jsonify(error=str(e)),400
    @app.errorhandler(LookupError)
    def missing(e):return jsonify(error=str(e)),404
    @app.errorhandler(413)
    def too_large(e):return jsonify(error='Filen får vara högst 20 MB.'),413
    @app.get('/api/session')
    def info():
        session.setdefault('csrf',secrets.token_urlsafe(24))
        return jsonify(admin=bool(session.get('admin')),csrf=session['csrf'],
                       tile_url=os.environ.get('MAP_TILE_URL','https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
                       tile_credit=os.environ.get('MAP_TILE_CREDIT','OpenStreetMap'))
    @app.post('/api/login')
    def login():
        b=body();now=time.monotonic()
        with lock:
            attempts[:]=[t for t in attempts if now-t<60]
            if len(attempts)>=10:return jsonify(error='För många inloggningsförsök. Vänta en minut.'),429
            attempts.append(now)
        if not check_password_hash(password_hash,str(b.get('password',''))):return jsonify(error='Fel administratörskod.'),401
        session['admin']=True
        return jsonify(ok=True)
    @app.post('/api/logout')
    def logout():session.pop('admin',None);return jsonify(ok=True)
    @app.get('/api/routes')
    def routes():
        con=db()
        try:items=[summary(json.loads(row[0])) for row in con.execute('SELECT payload FROM routes')]
        finally:con.close()
        return jsonify(routes=sorted(items,key=lambda r:r['created'],reverse=True))
    @app.post('/api/routes')
    @admin
    def upload():
        f=request.files.get('file')
        if not f or not (f.filename or '').lower().endswith('.gpx'):raise ValueError('Välj en GPX-fil.')
        raw=f.read(20*1024*1024+1)
        if len(raw)>20*1024*1024:raise ValueError('Filen får vara högst 20 MB.')
        route=parse_gpx(raw)
        b=dict(request.form)
        if not b.get('name','').strip():b['name']=route['gpx_name'] or Path(f.filename).stem
        route.update(metadata(b))
        route.update(id=secrets.token_hex(8),created=int(time.time()),updated=int(time.time()),revision=1,cafes=[],
                     surfaces=[{'start':0,'end':route['distance'],'kind':'unknown','source':'unknown'}])
        fingerprint=hashlib.sha256(raw).hexdigest()
        con=db()
        try:
            with con:con.execute('INSERT INTO routes VALUES (?,?,?)',(route['id'],fingerprint,json.dumps(route)))
        except sqlite3.IntegrityError:raise ValueError('Den här GPX-filen finns redan i ruttbanken.')
        finally:con.close()
        return jsonify(route),201
    @app.get('/api/routes/<key>')
    def detail(key):return jsonify(load(key))
    @app.patch('/api/routes/<key>')
    @admin
    def edit(key):
        b=body()
        with lock:
            r=load(key)
            if b.get('revision')!=r['revision']:return jsonify(error='Rutten har ändrats i en annan flik. Öppna rutten på nytt.'),409
            action=b.get('action')
            if action=='metadata':r.update(metadata(b))
            elif action=='surface':r['surfaces']=paint(r['surfaces'],b.get('start'),b.get('end'),b.get('kind'),r['distance'])
            elif action=='cafe':
                lat,lon=number(b.get('lat')),number(b.get('lon'))
                if not -90<=lat<=90 or not -180<=lon<=180:raise ValueError('Välj en plats på kartan.')
                if len(r['cafes'])>=100:raise ValueError('Högst 100 fikastopp per rutt.')
                closest=min(r['points'],key=lambda p:(p[0]-lat)**2+((p[1]-lon)*.5)**2)
                r['cafes'].append({'id':secrets.token_hex(6),'name':text(b.get('name',''),120,True),
                                  'note':text(b.get('note',''),500),'lat':lat,'lon':lon,'distance':closest[3]})
            elif action=='remove_cafe':r['cafes']=[c for c in r['cafes'] if c['id']!=b.get('cafe_id')]
            else:raise ValueError('Okänd ändring.')
            save(r)
        return jsonify(r)
    @app.post('/api/routes/<key>/suggest-surfaces')
    @admin
    def suggest(key):
        b=body();r=load(key)
        if b.get('revision')!=r['revision']:return jsonify(error='Öppna rutten igen innan du hämtar förslag.'),409
        if not osm_lock.acquire(blocking=False):return jsonify(error='En karthämtning pågår redan.'),429
        try:
            if time.monotonic()-osm_last[0]<60:return jsonify(error='Vänta en minut mellan karthämtningarna.'),429
            osm_last[0]=time.monotonic()
            from osm import fetch_suggestions
            spans=fetch_suggestions(r['points'])
            # Manual edits always win, including explicitly unknown stretches.
            for s in r['surfaces']:
                if s['source']=='manual':spans=paint(spans,s['start'],s['end'],s['kind'],r['distance'])
            with lock:
                if load(key)['revision']!=r['revision']:return jsonify(error='Rutten ändrades under hämtningen. Inga förslag sparades.'),409
                r['surfaces']=spans;save(r)
            return jsonify(r)
        finally:osm_lock.release()
    @app.delete('/api/routes/<key>')
    @admin
    def delete(key):
        with lock:
            load(key);con=db()
            try:
                with con:con.execute('DELETE FROM routes WHERE id=?',(key,))
            finally:con.close()
        return jsonify(ok=True)
    @app.get('/api/routes/<key>/download')
    def download(key):
        r=load(key)
        return send_file(io.BytesIO(export_gpx(r)),mimetype='application/gpx+xml',as_attachment=True,download_name=r['name']+'.gpx')
    @app.get('/')
    @app.get('/rutt/<key>')
    def index(key=None):return send_from_directory(ROOT/'dist','index.html')
    @app.get('/<path:name>')
    def asset(name):
        allowed={'app.js':'text/javascript','styles.css':'text/css','favicon.svg':'image/svg+xml',
                 'vendor/leaflet.js':'text/javascript','vendor/leaflet.css':'text/css'}
        if name not in allowed:return 'Not found',404
        return send_from_directory(ROOT/'dist',name,mimetype=allowed[name])
    return app
