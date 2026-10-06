// Shared data rules, independent of Leaflet and the DOM.
export const evidenceLabels = {
  fulltext: '全文资料', preview: '论文公开预览', excerpt: '检索摘要',
  inference: '相邻项目 / OSM 推定', secondary: '自媒体资料', unknown: '证据等级待整理',
};
export const sourceLabels = {
  project_range: '项目标准 · 范围初配', route_default: '路线标准默认 · 分段待核',
  historical_baseline: '历史车道基线 · 当前状态待补', osm_reference: 'OSM 参考 · 公告待确认',
};
export const laneOf = p => p.lanes_documented ?? p.lanes_reference ?? null;
export const idOf = feature => String(feature.id ?? feature.properties.osm_id);
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
}[c]));

// Null geometry patches attributes; a LineString adds/replaces geometry.
// Retired records remain in the update ledger but leave the displayed network.
export function applyUpdates(roads, updates) {
  const byId = new Map(roads.features.map(feature => [idOf(feature), feature]));
  for (const update of updates.features) {
    const id = idOf(update);
    if (update.properties.retired) { byId.delete(id); continue; }
    const original = byId.get(id);
    if (!original && !update.geometry) throw new Error(`修正记录 ${id} 没有对应道路或新增几何`);
    byId.set(id, { type:'Feature', id, geometry:update.geometry ?? original.geometry,
      properties:{ ...original?.properties, ...update.properties } });
  }
  return { type:'FeatureCollection', features:[...byId.values()] };
}

export function matches(feature, project, filters) {
  const p = feature.properties;
  const query = filters.query.trim().toLowerCase();
  if (query) {
    const refs = (p.ref || '').toLowerCase().split(';').map(ref => ref.trim());
    const text = [p.ref, p.name, project?.name, project?.scope].join(' ').toLowerCase();
    if (/^[gs]\d+$/.test(query) ? !refs.includes(query) : !text.includes(query)) return false;
  }
  if (filters.lane !== 'all' && Number(filters.lane) !== laneOf(p)) return false;
  if (filters.evidence !== 'all' && filters.evidence !== (project?.evidence_group || 'unknown')) return false;
  return filters.source === 'conflict' ? Boolean(p.lane_conflict)
    : filters.source === 'all' || filters.source === p.lane_source;
}

function sourceLink(url, label) {
  return /^https?:\/\//i.test(url || '')
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} ↗</a>` : '';
}

function evidenceHtml(project) {
  const seen = new Set();
  return [project, ...(project.evidence || [])].map(item => {
    const key = `${item.source_url}|${item.quote}`;
    if (seen.has(key)) return '';
    seen.add(key);
    return `${item.quote ? `<blockquote>${escapeHtml(item.quote)}</blockquote>` : ''}${sourceLink(item.source_url, item.role || '查看来源原文')}`;
  }).join('');
}

export function expansionTarget(expansion, projectId) {
  return expansion.target_lanes_by_project?.[projectId] ?? expansion.default_target_lanes ?? expansion.target_lanes;
}

export function roadPopup(feature, project, expansions, metadata) {
  const p = feature.properties;
  const e = escapeHtml;
  const lane = laneOf(p);
  const expansionHtml = expansions.filter(item => item.matched_project_ids.some(id =>
    [p.project_id, ...(p.overlapping_project_ids || [])].includes(id))).map(item => {
    const target = expansionTarget(item, p.project_id);
    const split = item.target_lanes_by_project || item.default_target_lanes != null;
    const targetText = (!split && item.target_lanes_text) || (target != null ? `双向 ${target} 车道` : '待明确');
    return `<div class="expansion"><h3>${e(item.name)}</h3><span class="badge">正在改扩建</span>
      <p><b>设计目标：${e(targetText)}</b><br>既有车道基线：双向 ${e(lane ?? item.current_lanes ?? '待明确')} 车道</p>
      <dl><dt>适用范围</dt><dd>${e(item.scope)}</dd><dt>状态依据</dt><dd>${e(item.status_date || '未注明')}</dd><dt>核对日期</dt><dd>${e(item.checked_on)}</dd>
      ${item.planned_open ? `<dt>计划通车</dt><dd>${e(item.planned_open)}（计划）</dd>` : ''}</dl>
      ${item.stage ? `<p>${e(item.stage)}</p>` : ''}
      ${item.traffic_control_note ? `<p class="warn">${e(item.traffic_control_note)}</p>` : ''}
      ${item.target_lane_evidence_level === 'search_excerpt' ? '<p class="warn">设计车道依据为检索摘要，全文尚待取得。</p>' : ''}
      ${evidenceHtml(item)}<p class="hint">${e(item.geometry_note)}</p></div>`;
  }).join('');
  return `<div class="popup"><h3>${e(p.ref || '编号待核')} · ${e(p.name || project?.name || '高速主线')}</h3>
    <div class="value">${lane == null ? '车道数待核实' : `双向 ${e(lane)} 车道`}</div>
    <span class="badge">${e(sourceLabels[p.lane_source] || '判断方式待整理')}</span>
    <p class="warn">展示标准不等于当前实际开放车道；范围为近似匹配，未经桩号级核定。
    ${p.lane_source === 'osm_reference' ? '仅为 OSM 参考，未获得公告确认。' : ''}</p>
    ${project ? `<dl><dt>依据项目</dt><dd>${e(project.name)}</dd><dt>适用范围</dt><dd>${e(project.scope)}</dd>
      <dt>资料类型</dt><dd>${e(evidenceLabels[project.evidence_group] || evidenceLabels.unknown)}</dd>
      <dt>发布日期</dt><dd>${e(project.published || '未注明')}</dd><dt>通车日期</dt><dd>${e(project.opened || '未给精确日期')}</dd>
      <dt>核对日期</dt><dd>${e(project.checked_on || metadata.source_checked_on)}</dd></dl>
      ${project.lanes_planned ? `<p>改扩建目标：双向 ${e(project.lanes_planned)} 车道。</p>` : ''}
      ${project.historical_status ? `<p>${e(project.historical_status)}</p>` : ''}
      ${evidenceHtml(project)}<p class="hint">${e(project.note)}</p>` : ''}
    <dl><dt>OSM 单侧</dt><dd>${e(p.lanes_osm ?? '未标注')}</dd><dt>双向候选</dt><dd>${e(p.lanes_total_candidate ?? '未可靠配对')}${p.lane_conflict ? ' · 与资料标准不同' : ''}</dd>
    <dt>道路 ID</dt><dd>${p.osm_id ? sourceLink(`https://www.openstreetmap.org/way/${encodeURIComponent(p.osm_id)}`, p.osm_id) : e(idOf(feature))}</dd></dl>
    ${p.update_note ? `<p class="hint">更新说明：${e(p.update_note)}（${e(p.checked_on || '日期待补')}）</p>` : ''}
    <p class="hint">道路快照 ${e(metadata.osm_snapshot_at.slice(0,10))}；快照日期不代表现场核验日期。</p>${expansionHtml}</div>`;
}
