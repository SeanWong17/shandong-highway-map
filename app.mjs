import { applyUpdates, idOf, laneOf, matches, roadPopup } from './core.mjs';

const $ = id => document.getElementById(id);
let statusTimer;
function status(message, persistent = false) {
  clearTimeout(statusTimer);
  $('status').textContent = message;
  $('status').hidden = false;
  if (!persistent) statusTimer = setTimeout(() => { $('status').hidden = true; }, 4500);
}

// Keep the panel usable while the CDN or the dataset is loading.
$('fold').addEventListener('click', () => {
  const collapsed = $('panel').classList.toggle('collapsed');
  $('fold').textContent = collapsed ? '筛选' : '收起';
  $('fold').setAttribute('aria-expanded', String(!collapsed));
});
if (matchMedia('(max-width:700px)').matches) $('fold').click();
for (const node of document.querySelectorAll('#filters input, #filters button, #filters select, #download')) node.disabled = true;

async function loadFile(name) {
  const response = await fetch(`./data/${name}`);
  if (!response.ok) throw new Error(`道路数据加载失败（HTTP ${response.status}）`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Some hosts set Content-Encoding: gzip; fetch has already decoded it then.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(bytes));
  if (!('DecompressionStream' in window)) throw new Error('请使用支持 gzip 解压的现代浏览器（Chrome / Edge 80+、Firefox 113+、Safari 16.4+）');
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
}

async function loadData() {
  const [config, roads, projects, expansions, updates, province, cities, basemap] = await Promise.all([
    'config.json','roads.geojson.gz','projects.json','expansions.json','updates.geojson','province.geojson','cities.geojson','basemap.json',
  ].map(loadFile));
  return { ...config, roads:applyUpdates(roads,updates), projects, expansions:expansions.projects, province, cities, basemap };
}

async function start() {
  if (!window.L) throw new Error('地图组件加载失败');
  const data = await loadData();
  const map = L.map('map', { preferCanvas:true, zoomControl:false, minZoom:6, maxZoom:9.5, zoomSnap:.5 });
  L.control.zoom({ position:'topright' }).addTo(map);
  L.control.scale({ imperial:false, position:'bottomright' }).addTo(map);
  map.attributionControl.addAttribution('道路 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · ODbL');
  const cityBorders = L.geoJSON(data.cities, {
    interactive:false, style:{ color:'#91aaa2', weight:.8, opacity:.65, fillOpacity:0 },
  });
  const outline = L.geoJSON(data.province, {
    interactive:false, style:{ color:'#789990', weight:1.5, fillOpacity:0 },
  });
  const cityLabels = data.cities.features.map(({properties}) => L.marker([
    properties.center[1],properties.center[0],
  ], {
    interactive:false, icon:L.divIcon({ className:'city-label', html:properties.name.replace(/市$/, ''), iconSize:[48,20], iconAnchor:[24,10] }),
  }));
  const bases = {
    street: L.imageOverlay('assets/street.jpg', data.basemap.bounds, { opacity:.8,
      attribution:'底图数据：<a href="https://www.naturalearthdata.com/">Natural Earth</a>（公共领域）' }),
    terrain: L.imageOverlay('assets/terrain.jpg', data.basemap.bounds, { opacity:.8,
      attribution:'高程：<a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a> / Mapzen / Tilezen；USGS SRTM、GMTED2010、NOAA ETOPO1' }),
  };
  let currentBase;
  const setBase = () => {
    if (currentBase) map.removeLayer(currentBase);
    currentBase = bases[$('basemap').value];
    $('map').classList.toggle('terrain-base', $('basemap').value === 'terrain');
    $('tile-status').textContent = '本地底图，无需在线瓦片。';
    currentBase.addTo(map);
  };
  for (const base of Object.values(bases)) {
    base.on('error', () => {
      if (base === currentBase) $('tile-status').textContent = '底图文件加载失败，请刷新页面重试。';
    });
    base.on('load', () => {
      if (base === currentBase) $('tile-status').textContent = '本地底图加载完成。';
    });
  }
  $('basemap').addEventListener('change', setBase);
  $('opacity').addEventListener('input', () => {
    const opacity = Number($('opacity').value) / 100;
    for (const base of Object.values(bases)) base.setOpacity(opacity);
    $('opacity-value').value = `${Math.round(opacity * 100)}%`;
  });
  map.setView([36.3,118.5],7);
  setBase();
  L.featureGroup([cityBorders,outline,...cityLabels]).addTo(map);

  const projects = new Map(data.projects.map(project => [project.id, project]));
  const renderer = L.canvas({ padding:.25, tolerance:5 });
  const layers = new Map();
  const roadLayer = L.geoJSON(data.roads, {
    style(feature) {
      const dashed = feature.properties.line_style === 'dashed';
      return { color:data.colors[laneOf(feature.properties)] || '#82939c', weight:dashed ? 2.3 : 3.2,
        opacity:.9, dashArray:dashed ? '8 6' : null, renderer };
    },
    onEachFeature(feature, layer) {
      layers.set(idOf(feature), layer);
      layer.on('click', event => {
        L.popup({ maxWidth:350 }).setLatLng(event.latlng).setContent(roadPopup(
          feature, projects.get(feature.properties.project_id), data.expansions, data.metadata,
        )).openOn(map);
      });
    },
  }).addTo(map);
  let visible = data.roads.features;
  let visibleIds = new Set(layers.keys());
  let searchTimer;
  let previousFilter;
  const filters = () => ({ query:$('search').value, lane:$('lane').value, evidence:$('evidence').value, source:$('source').value });
  function render() {
    clearTimeout(searchTimer);
    const selected = filters();
    const key = JSON.stringify(selected);
    if (previousFilter === key) return;
    previousFilter = key;
    visible = data.roads.features.filter(feature => matches(feature, projects.get(feature.properties.project_id), selected));
    const next = new Set(visible.map(idOf));
    for (const id of visibleIds) if (!next.has(id)) roadLayer.removeLayer(layers.get(id));
    for (const id of next) if (!visibleIds.has(id)) roadLayer.addLayer(layers.get(id));
    visibleIds = next;
    map.closePopup();
    $('count').textContent = visible.length ? `${visible.length.toLocaleString()} 条道路短线` : '无匹配路段';
    $('download').disabled = !visible.length;
  }
  const allBounds = roadLayer.getBounds();
  function fit(bounds) {
    const compact = $('panel').classList.contains('collapsed');
    const mobile = matchMedia('(max-width:700px)').matches;
    map.fitBounds(bounds, { paddingTopLeft:mobile ? [20,compact ? 122 : Math.min($('panel').offsetHeight + 25, innerHeight * .7)] : [370,30],
      paddingBottomRight:[35,35], maxZoom:9.5, animate:false });
  }
  $('filters').addEventListener('submit', event => {
    event.preventDefault();
    render();
    if (visible.length) {
      if (matchMedia('(max-width:700px)').matches && !$('panel').classList.contains('collapsed')) $('fold').click();
      fit(roadLayer.getBounds());
    } else status('没有匹配路段，请调整搜索词或筛选条件。');
  });
  $('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(render,200); });
  for (const id of ['lane','evidence','source']) $(id).addEventListener('change',render);
  $('reset').addEventListener('click', () => { $('filters').reset(); render(); fit(allBounds); });
  $('download').addEventListener('click', () => {
    const projectIds = new Set(visible.flatMap(feature => [feature.properties.project_id, ...(feature.properties.overlapping_project_ids || [])]));
    const value = { type:'FeatureCollection', metadata:{ ...data.metadata, filters:filters(),
      attribution:'© OpenStreetMap contributors', license:'ODbL-1.0',
      note:'展示车道标准及近似项目匹配，不代表当前实际开放车道；短线数量不是高速条数或运营里程。' },
      projects:data.projects.filter(project => projectIds.has(project.id)),
      expansions:data.expansions.filter(item => item.matched_project_ids.some(id => projectIds.has(id))),
      features:visible };
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(value)],{ type:'application/geo+json' }));
    link.download = 'shandong-highways.geojson';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href),1000);
  });
  $('checked').textContent = data.metadata.source_checked_on;
  $('snapshot').textContent = data.metadata.osm_snapshot_at.slice(0,10);
  for (const node of document.querySelectorAll('#filters input, #filters button, #filters select, #download')) node.disabled = false;
  render();
  fit(allBounds);
  $('status').hidden = true;
}

start().catch(error => {
  $('count').textContent = '加载失败';
  status(`${error.message}。请通过 HTTP 服务打开项目；重试可刷新页面。`, true);
  console.error(error);
});
