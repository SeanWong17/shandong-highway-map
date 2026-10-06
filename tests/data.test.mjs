import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { applyUpdates, idOf, matches, roadPopup, expansionTarget } from '../core.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url)));
const config = read('config.json');
const base = JSON.parse(gunzipSync(readFileSync(new URL('../data/roads.geojson.gz', import.meta.url))));
const roads = applyUpdates(base, read('updates.geojson')).features;
const projects = new Map(read('projects.json').map(p => [p.id,p]));
const expansions = read('expansions.json').projects;
const defaults = { query:'', lane:'all', evidence:'all', source:'all' };
const select = filters => roads.filter(f => matches(f,projects.get(f.properties.project_id),{ ...defaults,...filters }));
assert.equal(roads.length,24939);
for (const [lane,count] of [[4,14111],[5,108],[6,5959],[8,4633],[12,128]]) assert.equal(select({ lane:String(lane) }).length,count);
assert.equal(select({ source:'osm_reference' }).length,29);
assert.equal(select({ source:'conflict' }).length,2322);
assert.equal(select({ evidence:'excerpt' }).length,34);
assert.ok(select({ query:' g3 ' }).every(f => f.properties.ref.split(';').includes('G3')));
assert.ok(select({ query:'济菏',lane:'8' }).length > 0);
assert.equal(select({ query:'不存在的路线' }).length,0);
const south = roads.find(f => f.properties.project_id === 'P119');
const html = roadPopup(south,projects.get('P119'),expansions,config.metadata);
assert.match(html,/既有车道基线：双向 4 车道/);
assert.match(html,/设计目标：双向 8 车道/);
const split = expansions.find(e => e.id === 'E03');
assert.equal(expansionTarget(split,'P69'),6);
assert.equal(expansionTarget(split,split.matched_project_ids.find(id => id !== 'P69')),4);
const malicious = { ...projects.get('P119'), name:'<script>alert(1)</script>', source_url:'javascript:alert(1)', evidence:[] };
const safe = roadPopup(south,malicious,[],config.metadata);
assert.doesNotMatch(safe,/<script>|href="javascript:/);
assert.match(safe,/&lt;script&gt;/);

// Simulate an opening, a newly built road and a retired geometry without mutating the snapshot.
const id = idOf(south);
const newRoad = { type:'Feature',id:'local:demo',geometry:{ type:'LineString',coordinates:[[117,36],[117.1,36.1]] },
  properties:{ ref:'S999',name:'测试新路',lanes_documented:6,project_id:'NEW',lane_source:'project_range',line_style:'solid' } };
const changed = applyUpdates({ type:'FeatureCollection',features:[south,roads[0]] },{
  features:[{ type:'Feature',id,geometry:null,properties:{ lanes_documented:8,project_id:'NEW' } },newRoad,
    { type:'Feature',id:idOf(roads[0]),geometry:null,properties:{ retired:true } }],
});
assert.equal(changed.features.length,2);
assert.equal(changed.features[0].properties.lanes_documented,8);
assert.equal(changed.features[0].properties.project_id,'NEW');
assert.equal(changed.features[0].geometry,south.geometry);
assert.equal(south.properties.lanes_documented,4);
assert.equal(idOf(changed.features[1]),'local:demo');
assert.throws(() => applyUpdates(base,{ features:[{ id:'missing',geometry:null,properties:{} }] }),/没有对应道路/);
console.log('通过：快照数量、组合筛选、改扩建分段目标、安全来源弹窗、新建 / 更新 / 停用道路。');
