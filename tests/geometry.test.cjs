const fs=require('node:fs');const vm=require('node:vm');const assert=require('node:assert/strict');
const source=fs.readFileSync('dist/app.js','utf8').split("document.addEventListener('click'")[0];
const context={console,URLSearchParams,setTimeout,clearTimeout};vm.createContext(context);vm.runInContext(source,context);
const pts=[[58,15,10,0,0],[58.001,15,20,100,0],[59,16,40,100,1],[59.001,16,50,200,1]];
const spans=[{start:0,end:40,kind:'gravel'},{start:40,end:160,kind:'asphalt'},{start:160,end:200,kind:'unknown'}];
const paths=context.coloredPaths(pts,spans);
assert.equal(paths.length,4);assert.equal(paths[0].kind,'gravel');assert.equal(paths[1].segment,0);assert.equal(paths[2].segment,1);
assert.ok(Math.abs(paths[0].coords.at(-1)[0]-58.0004)<1e-9);
assert.equal(context.pointAt(pts,150)[2],45);
assert.ok(context.thumbnail({preview:pts}).includes('<svg'));
console.log('Map geometry: surface boundaries, track gaps, interpolation and previews passed.');
const controls=Object.fromEntries(['search','surface-filter','race-filter','segment-filter','cafe-filter','length','sort','radius'].map(id=>[id,{value:id==='search'?'':'all',checked:false}]));
context.document={getElementById:id=>controls[id]};
vm.runInContext(`state.position={latitude:58,longitude:15};state.category='mtb';state.routes=[
{id:'far',category:'mtb',is_race_course:true,is_strava_segment:true,preview:[[59,15]],distance:1000},
{id:'near',category:'mtb',is_race_course:true,is_strava_segment:true,preview:[[58.01,15]],distance:1000},
{id:'road',category:'road',is_race_course:true,preview:[[58,15]],distance:1000}];`,context);
controls.sort.value='near';controls['race-filter'].checked=true;controls['segment-filter'].checked=true;
assert.equal(context.filtered().map(r=>r.id).join(','),'near,far');
controls.radius.value='10';assert.equal(context.filtered().map(r=>r.id).join(','),'near');
assert.ok(Math.abs(context.startDistance({preview:[[59,15]]})-111.195)<.01);
console.log('Nearby sorting, radius and combined MTB/race/segment filters passed.');
