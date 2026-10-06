"""Validate editable data and the effective road network (Python standard library)."""
import gzip
import json
import math
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LANES = {4, 5, 6, 8, 12}
SOURCES = {'project_range', 'route_default', 'historical_baseline', 'osm_reference'}
GROUPS = {'fulltext', 'preview', 'excerpt', 'inference', 'secondary', 'unknown'}


def read(name):
    raw = (ROOT / 'data' / name).read_bytes()
    return json.loads(gzip.decompress(raw) if name.endswith('.gz') else raw)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def checked_date(value, label):
    require(isinstance(value, str), f'{label} 缺少 YYYY-MM-DD 日期')
    date.fromisoformat(value)


def check_source(project):
    require(project.get('name') and project.get('scope'), f'{project["id"]} 缺少名称或范围')
    require(str(project.get('source_url', '')).startswith(('https://', 'http://')),
            f'{project["id"]} 缺少 http(s) 来源链接')
    require(project.get('quote'), f'{project["id"]} 缺少依据引句')
    checked_date(project.get('checked_on'), project['id'])


def main():
    config = read('config.json')
    checked_date(config['metadata']['source_checked_on'], 'config 核对日期')
    checked_date(config['metadata']['data_version'], 'config 数据版本')
    require(all(str(lane) in config['colors'] for lane in LANES), '配置缺少车道颜色')
    projects = read('projects.json')
    ids = [project['id'] for project in projects]
    require(len(ids) == len(set(ids)), '项目 ID 重复')
    for project in projects:
        check_source(project)
        require(project['checked_on'] <= config['metadata']['source_checked_on'],
                f'{project["id"]} 依据比 config 核对日期新，请同步修改 config')
        require(project.get('evidence_group') in GROUPS, f'{project["id"]} 资料类型无效')
        require(project.get('lanes') is None or project['lanes'] in LANES,
                f'{project["id"]} 车道标准无效')
        require(all(lane in LANES for lane in (project.get('lanes_documented_options') or [])),
                f'{project["id"]} 分段车道标准无效')
    project_ids = set(ids)
    project_by_id = {project['id']: project for project in projects}
    roads = read('roads.geojson.gz')
    require(roads.get('type') == 'FeatureCollection', '道路数据必须为 FeatureCollection')
    by_id = {}
    for feature in roads['features']:
        key = str(feature.get('id', feature['properties'].get('osm_id', '')))
        require(key and key not in by_id, f'道路 ID 为空或重复：{key}')
        by_id[key] = feature
    updates = read('updates.geojson')
    require(updates.get('type') == 'FeatureCollection', '更新必须为 FeatureCollection')
    seen = set()
    for update in updates['features']:
        key = str(update.get('id', ''))
        require(key and key not in seen, f'更新 ID 为空或重复：{key}')
        seen.add(key)
        require(update.get('type') == 'Feature', f'{key} 更新必须为 Feature')
        props = update['properties']
        require(props.get('update_note'), f'{key} 缺少更新理由 update_note')
        checked_date(props.get('checked_on'), key)
        require(props['checked_on'] <= config['metadata']['source_checked_on'],
                f'{key} 更新比 config 核对日期新，请同步修改 config')
        if props.get('retired'):
            require(key in by_id, f'{key} 停用记录没有对应道路')
            del by_id[key]
            continue
        original = by_id.get(key)
        require(original is not None or update.get('geometry'), f'{key} 新增道路缺少几何')
        if 'lanes_documented' in props or original is None:
            require(all(k in props for k in ('project_id', 'lane_source', 'line_style')),
                    f'{key} 更改车道或新增道路时必须同时给出依据项目、判断方式和线型')
        by_id[key] = {'type':'Feature', 'id':key,
                      'geometry':update.get('geometry') or original['geometry'],
                      'properties':{**(original['properties'] if original else {}), **props}}
    for key, feature in by_id.items():
        props, geometry = feature['properties'], feature['geometry']
        require(geometry['type'] == 'LineString' and len(geometry['coordinates']) >= 2,
                f'{key} 必须包含至少两点的 LineString')
        for point in geometry['coordinates']:
            require(len(point) == 2 and all(isinstance(v, (int, float)) and math.isfinite(v) for v in point)
                    and -180 <= point[0] <= 180 and -90 <= point[1] <= 90,
                    f'{key} 坐标必须为 WGS84 [经度,纬度]')
        require(props.get('lane_source') in SOURCES, f'{key} 判断方式无效')
        require(props.get('line_style') in {'solid', 'dashed'}, f'{key} 线型无效')
        lane = props.get('lanes_documented')
        if lane is None: lane = props.get('lanes_reference')
        require(lane in LANES, f'{key} 缺少有效的车道数')
        pid = props.get('project_id')
        require(pid in project_ids or (pid is None and props['lane_source'] == 'osm_reference'),
                f'{key} 引用了不存在的项目 {pid}')
        if pid in project_ids and props.get('lanes_documented') is not None:
            project = project_by_id[pid]
            allowed = [project.get('lanes')] + (project.get('lanes_documented_options') or [])
            require(props['lanes_documented'] in allowed,
                    f'{key} 道路标准与依据项目 {pid} 不一致')
        require(all(pid in project_ids for pid in props.get('overlapping_project_ids', [])),
                f'{key} 共线路段项目引用无效')
        if props['lane_source'] == 'osm_reference':
            require(props['line_style'] == 'dashed', f'{key} OSM 参考应使用虚线')
    expansion_ids = set()
    expansions = read('expansions.json')
    for project in expansions['projects']:
        check_source(project)
        require(project['checked_on'] <= config['metadata']['source_checked_on'],
                f'{project["id"]} 扩建记录比 config 核对日期新，请同步修改 config')
        require(project['id'] not in expansion_ids, '改扩建 ID 重复')
        expansion_ids.add(project['id'])
        require(project['status'] == 'expansion_active', f'{project["id"]} 只应记录既有道路正在改扩建')
        require(project.get('matched_project_ids') and all(pid in project_ids for pid in project['matched_project_ids']),
                f'{project["id"]} 改扩建项目引用无效')
        targets = project.get('target_lanes_by_project', {})
        require(all(pid in project['matched_project_ids'] and lane in LANES for pid, lane in targets.items()),
                f'{project["id"]} 分段目标无效')
        for field in ('current_lanes', 'target_lanes', 'default_target_lanes'):
            require(project.get(field) is None or project[field] in LANES,
                    f'{project["id"]} {field} 车道值无效')
    counts = Counter(p['properties'].get('lanes_documented') or p['properties'].get('lanes_reference')
                     for p in by_id.values())
    print(f'检查通过：{len(by_id):,} 条道路，{len(projects)} 个依据项目，{len(expansions["projects"])} 个改扩建项目。')
    print('双向车道短线统计：' + ', '.join(f'{lane} 车道 {count:,}' for lane, count in sorted(counts.items())))


if __name__ == '__main__':
    main()
