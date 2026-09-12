"""Local Windows entry point; dependencies installed into a project venv."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import threading
import webbrowser

ROOT=Path(__file__).resolve().parent

def bootstrap():
    if sys.version_info < (3,10):raise RuntimeError('Python 3.10 eller senare behovs.')
    env=ROOT/'.venv';python=env/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
    req=ROOT/'requirements.txt';fingerprint=hashlib.sha256(req.read_bytes()).hexdigest()
    marker=env/'installed-requirements.txt'
    if not python.exists():
        print('Skapar Python-miljo...',flush=True)
        subprocess.run([sys.executable,'-m','venv',str(env)],check=True)
    if not marker.exists() or marker.read_text()!=fingerprint:
        print('Installerar paket. Detta behovs bara vid forsta starten eller uppdatering.',flush=True)
        subprocess.run([str(python),'-m','pip','install','-r',str(req)],check=True)
        marker.write_text(fingerprint)
    return subprocess.call([str(python),str(ROOT/'start.py'),'--serve'])

def serve():
    from app import create_app
    from waitress import create_server
    public=os.environ.get('PUBLIC_URL','').strip().rstrip('/')
    app=create_app(public_url=public)
    server=create_server(app,host='127.0.0.1',port=8767,threads=6,max_request_body_size=21*1024*1024)
    url=public or 'http://localhost:8767'
    print('\nAlvins Ruttbank: '+url)
    print('Administrator: '+app.config['ADMIN_CODE'])
    print('Koden ger ratt att lagga till, andra och radera rutter. Dela inte koden med besokare.')
    print('Rutterna sparas i data/routes.sqlite3. Lat fonstret vara igang. Ctrl+C avslutar.\n',flush=True)
    threading.Timer(.5,lambda:webbrowser.open(url)).start()
    try:server.run()
    except KeyboardInterrupt:pass
    finally:server.close()

if __name__=='__main__':
    try:
        if '--serve' in sys.argv:serve()
        else:sys.exit(bootstrap())
    except KeyboardInterrupt:pass
    except Exception as e:
        print('Kunde inte starta: '+str(e),file=sys.stderr)
        print('Om port 8767 ar upptagen: stang tidigare startfonster.',file=sys.stderr)
        sys.exit(1)
