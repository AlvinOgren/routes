import io
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from app import create_app
from geometry import parse_gpx, paint, export_gpx
from osm import infer, kind

GPX=b'''<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Test route</name><trkseg><trkpt lat="58.4" lon="15.6"><ele>40</ele><time>2026-01-01T00:00:00Z</time></trkpt><trkpt lat="58.401" lon="15.6"><ele>50</ele></trkpt><trkpt lat="58.402" lon="15.6"><ele>44</ele></trkpt></trkseg></trk></gpx>'''
BASE='http://localhost:8767'

class RoutesTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.app=create_app(self.temp.name,password='test-pass')
        self.app.testing=True
        self.client=self.app.test_client()
        self.token=self.client.get('/api/session',base_url=BASE).json['csrf']
        self.headers={'X-CSRF-Token':self.token,'Origin':BASE}
        self.client.post('/api/login',json={'password':'test-pass'},headers=self.headers,base_url=BASE)
    def tearDown(self):self.temp.cleanup()
    def upload(self,raw=GPX):
        return self.client.post('/api/routes',base_url=BASE,headers=self.headers,
           data={'file':(io.BytesIO(raw),'round.gpx'),'name':'Årets runda','location':'Linköping','category':'gravel','description':'Grus & fika <script>not markup</script>'})
    def change(self,r,**kw):
        return self.client.patch('/api/routes/'+r['id'],base_url=BASE,headers=self.headers,json={'revision':r['revision'],**kw})
    def test_import_edit_export_persistence(self):
        res=self.upload();self.assertEqual(res.status_code,201);r=res.json
        self.assertAlmostEqual(r['distance'],222.39,delta=.1);self.assertEqual(r['ascent'],10);self.assertEqual(r['descent'],6)
        self.assertEqual(r['surfaces'][0]['kind'],'unknown')
        res=self.change(r,action='surface',start=20,end=120,kind='gravel');self.assertEqual(res.status_code,200);r=res.json
        self.assertEqual([s['kind'] for s in r['surfaces']],['unknown','gravel','unknown'])
        r=self.change(r,action='surface',start=80,end=150,kind='asphalt').json
        self.assertEqual([(s['start'],s['end'],s['kind']) for s in r['surfaces']][:3],[(0,20,'unknown'),(20,80,'gravel'),(80,150,'asphalt')])
        r=self.change(r,action='cafe',name='Kafé Å',note='Cykelställ',lat=58.401,lon=15.6002).json
        self.assertEqual(len(r['cafes']),1)
        response=self.client.get('/api/routes/'+r['id']+'/download',base_url=BASE)
        self.assertEqual(response.status_code,200);raw=response.data;response.close()
        self.assertIn('Kafé Å'.encode(),raw);self.assertNotIn(b'<time',raw);self.assertNotIn(b'<hr',raw)
        exported=parse_gpx(raw);self.assertAlmostEqual(exported['distance'],r['distance'])
        other=create_app(self.temp.name,password='test-pass').test_client()
        self.assertEqual(other.get('/api/routes/'+r['id'],base_url=BASE).json['cafes'][0]['name'],'Kafé Å')
        summaries=other.get('/api/routes',base_url=BASE).json['routes']
        self.assertEqual(summaries[0]['surface_totals']['gravel'],60)
        self.assertEqual(self.upload().status_code,400)
    def test_access_validation_and_conflicts(self):
        r=self.upload().json
        visitor=self.app.test_client();token=visitor.get('/api/session',base_url=BASE).json['csrf']
        response=visitor.get('/rutt/'+r['id'],base_url=BASE);self.assertEqual(response.status_code,200);response.close()
        self.assertEqual(visitor.delete('/api/routes/'+r['id'],base_url=BASE,headers={'X-CSRF-Token':token,'Origin':BASE},json={}).status_code,401)
        self.assertEqual(self.client.delete('/api/routes/'+r['id'],base_url=BASE,json={}).status_code,403)
        self.assertEqual(self.client.get('/',base_url='http://invalid.test').status_code,400)
        self.assertEqual(self.change(r,action='surface',start=0,end=9999,kind='gravel').status_code,400)
        self.assertEqual(self.change(r,action='surface',start=None,end=100,kind='gravel').status_code,400)
        updated=self.change(r,action='surface',start=0,end=100,kind='gravel').json
        self.assertEqual(self.change(r,action='surface',start=0,end=100,kind='asphalt').status_code,409)
        self.assertEqual(self.change(updated,action='metadata',name='X',source_url='javascript:alert(1)').status_code,400)
        for name in ['app.py','data/config.json','data/routes.sqlite3']:
            self.assertEqual(visitor.get('/'+name,base_url=BASE).status_code,404)
        self.assertEqual(self.client.delete('/api/routes/'+r['id'],headers=self.headers,base_url=BASE,json={}).status_code,200)
        self.assertEqual(visitor.get('/api/routes/'+r['id'],base_url=BASE).status_code,404)
    def test_gpx_missing_height_segments_and_bad_xml(self):
        gpx=b'<gpx><trk><trkseg><trkpt lat="58" lon="15"/><trkpt lat="58.001" lon="15"/></trkseg><trkseg><trkpt lat="59" lon="16"/><trkpt lat="59.001" lon="16"/></trkseg></trk></gpx>'
        r=parse_gpx(gpx);self.assertAlmostEqual(r['distance'],222.39,delta=.1);self.assertIsNone(r['ascent']);self.assertEqual(r['segments'],2)
        for raw in [b'<gpx/>',GPX.replace(b'58.4',b'nan'),b'<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]><gpx>&x;</gpx>',b'<html/>']:
            with self.assertRaises(ValueError):parse_gpx(raw)
    def test_osm_inference_and_manual_priority(self):
        r=self.upload().json
        ways=[{'tags':{'highway':'residential','surface':'asphalt'},'geometry':[{'lat':58.4,'lon':15.6},{'lat':58.402,'lon':15.6}]}]
        spans=infer(r['points'],ways);self.assertEqual({s['kind'] for s in spans},{'asphalt'})
        self.assertEqual(kind({'highway':'residential'}),'unknown')
        self.assertEqual(kind({'surface':'paved'}),'unknown')
        r=self.change(r,action='surface',start=0,end=50,kind='gravel').json
        with patch('osm.fetch_suggestions',return_value=spans):
            res=self.client.post('/api/routes/'+r['id']+'/suggest-surfaces',json={'revision':r['revision']},headers=self.headers,base_url=BASE)
        self.assertEqual(res.status_code,200);self.assertEqual(res.json['surfaces'][0]['kind'],'gravel');self.assertEqual(res.json['surfaces'][0]['source'],'manual')
        self.assertEqual(res.json['surfaces'][-1]['kind'],'asphalt')

if __name__=='__main__':unittest.main()
