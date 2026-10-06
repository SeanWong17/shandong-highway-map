// Run the production loader and event handlers with small DOM / Leaflet doubles.
// This checks application integration; it does not replace a browser visual check.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

for (const decoded of [false,true]) {
  const nodes = new Map();
  const classes = new Set();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value:['lane','source','evidence'].includes(id) ? 'all' : id === 'basemap' ? 'street' : '',
      textContent:'', hidden:false, disabled:false, offsetHeight:400, listeners:{},
      addEventListener(name,callback) { this.listeners[name] = callback; },
      setAttribute() {},
      classList:{ contains:name => classes.has(name), toggle(name,force) {
        if (force !== undefined) { if (force) classes.add(name); else classes.delete(name); return force; }
        if (classes.has(name)) { classes.delete(name); return false; }
        classes.add(name); return true;
      } },
      click() { this.listeners.click?.(); },
      reset() { element('search').value = ''; for (const id of ['lane','evidence','source']) element(id).value = 'all'; },
    });
    return nodes.get(id);
  };
  const controls = ['search','lane','evidence','source','download'].map(element);
  let capturedRoads;
  let popupText;
  let changes = 0;
  const overlays = [];
  const layer = () => ({
    children:new Set(), listeners:{},
    addTo() { return this; }, on(name,callback) { this.listeners[name] = callback; return this; },
    addLayer(child) { this.children.add(child); changes++; }, removeLayer(child) { this.children.delete(child); changes++; },
    getBounds() { return {}; }, setOpacity() {}, setStyle() {},
    setLatLng() { return this; }, setContent(value) { popupText = value; return this; }, openOn() {},
  });
  const map = { attributionControl:{ addAttribution() {} }, setView() {}, fitBounds() {}, removeLayer() {}, closePopup() {} };
  globalThis.document = { getElementById:element, querySelectorAll:() => controls };
  globalThis.window = globalThis;
  globalThis.matchMedia = () => ({ matches:false });
  globalThis.innerHeight = 1000;
  globalThis.L = {
    map:() => map, control:{ zoom:layer, scale:layer }, imageOverlay:(url,bounds) => {
      overlays.push({url,bounds}); return layer();
    }, featureGroup:layer,
    marker:layer, divIcon:() => ({}), canvas:() => ({}), popup:layer,
    geoJSON(data,options) {
      const group = layer();
      for (const feature of data.features) {
        const child = layer();
        child.feature = feature;
        options.onEachFeature?.(feature,child);
        group.addLayer(child);
      }
      if (options.onEachFeature) capturedRoads = group;
      return group;
    },
  };
  globalThis.fetch = async url => {
    const name = url.split('/').pop();
    let bytes = readFileSync(new URL(`../data/${name}`,import.meta.url));
    if (decoded && name.endsWith('.gz')) bytes = gunzipSync(bytes);
    return new Response(bytes);
  };
  await import(`../app.mjs?decoded=${decoded}`);
  for (let attempt = 0; attempt < 100 && !element('count').textContent.includes('24,939'); attempt++) {
    await new Promise(resolve => setTimeout(resolve,10));
  }
  assert.match(element('count').textContent,/24,939/);
  assert.equal(capturedRoads.children.size,24939);
  assert.equal(element('checked').textContent,'2026-09-30');
  assert.equal(element('download').disabled,false);
  assert.deepEqual(overlays.map(item => item.url),['assets/street.jpg','assets/terrain.jpg']);
  assert.deepEqual(overlays[0].bounds,[[33.137551192346145,113.90625],[39.36827914916013,123.75]]);
  element('basemap').value = 'terrain';
  element('basemap').listeners.change();
  element('lane').value = '12';
  element('lane').listeners.change();
  assert.equal(capturedRoads.children.size,128);
  const previousChanges = changes;
  element('lane').listeners.change();
  assert.equal(changes,previousChanges);
  element('reset').click();
  assert.equal(capturedRoads.children.size,24939);
  const south = [...capturedRoads.children].find(child => child.feature.properties.project_id === 'P119');
  south.listeners.click({ latlng:[36,117] });
  assert.match(popupText,/设计目标：双向 8 车道/);
  element('search').value = 'G3';
  element('filters').listeners.submit({ preventDefault() {} });
  assert.ok(capturedRoads.children.size > 0);
  assert.ok([...capturedRoads.children].every(child => child.feature.properties.ref.split(';').includes('G3')));
  element('search').value = '不存在的路线';
  element('filters').listeners.submit({ preventDefault() {} });
  assert.equal(capturedRoads.children.size,0);
  assert.equal(element('download').disabled,true);
  element('reset').click();
  assert.equal(capturedRoads.children.size,24939);
}
console.log('通过：页面压缩 / 自动解压数据加载、筛选事件、重复筛选、复位和来源弹窗（非浏览器）。');
