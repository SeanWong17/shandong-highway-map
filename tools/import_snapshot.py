"""One-time import from the reference project; runtime has no reference dependency."""
import argparse
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIELDS = (
    'osm_id', 'ref', 'name', 'lanes_documented', 'lanes_reference', 'line_style',
    'project_id', 'overlapping_project_ids', 'lane_conflict', 'lane_source',
    'lanes_osm', 'lanes_total_candidate',
)
PROJECT_FIELDS = (
    'id', 'name', 'scope', 'lanes', 'lanes_documented_options', 'lanes_planned',
    'published', 'opened', 'source_url', 'quote', 'note', 'checked_on',
    'evidence_level', 'historical_status', 'current_2026_site_verified',
)
FULLTEXT = {
    'government_or_mainstream_fulltext', 'official_or_government_repost', 'source_fulltext',
    'government_or_media_fulltext', 'media_or_project_report', 'official_target_with_historical_baseline',
    'construction_company_report', 'media_opening_fulltext', 'government_fulltext',
    'government_repost_fulltext', 'tender_archive_fulltext', 'engineering_paper_fulltext',
    'government_repost', 'secondary_project_fulltext',
}


def read(folder, name):
    raw = (folder / name).read_bytes()
    return json.loads(gzip.decompress(raw) if name.endswith('.gz') else raw)


def evidence(items):
    # Preserve every distinct source and quote; omit duplicate records and file hashes.
    result, seen = [], set()
    for item in items:
        key = item.get('source_url'), item.get('quote')
        if key not in seen:
            seen.add(key)
            result.append({k: item[k] for k in ('source_url', 'quote', 'published', 'role') if k in item})
    return result


def write(name, data):
    destination = ROOT / 'data' / name
    destination.parent.mkdir(exist_ok=True)
    if name.endswith('.gz'):
        raw = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
        destination.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    else:
        destination.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Reference project directory')
    args = parser.parse_args()
    if (ROOT / 'data' / 'config.json').exists():
        parser.error('目标数据已存在；导入仅用于首次提取，避免覆盖后续人工更新。')
    source = args.source / 'data'
    roads = read(source, 'roads.geojson.gz')
    for feature in roads['features']:
        feature['properties'] = {k: feature['properties'][k] for k in FIELDS
                                 if feature['properties'].get(k) is not None}
        feature['geometry']['coordinates'] = [[round(x, 6), round(y, 6)]
                                              for x, y in feature['geometry']['coordinates']]
    projects = []
    groups = {'technical_paper_public_preview':'preview', 'search_excerpt':'excerpt',
              'adjacent_project_standard_inference':'inference', 'osm_pairing_reference':'inference',
              'local_selfmedia_fulltext':'secondary'}
    for original in read(source, 'projects.json'):
        project = {k: original[k] for k in PROJECT_FIELDS if k in original}
        level = original.get('evidence_level')
        project['evidence_group'] = 'fulltext' if level in FULLTEXT else groups.get(level, 'unknown')
        project['evidence'] = evidence(original.get('evidence', []))
        projects.append(project)
    expansions = read(source, 'expansions.json')
    for project in expansions['projects']:
        project['evidence'] = evidence(project.get('evidence', []))
        project.pop('matched_way_count', None)
    write('roads.geojson.gz', roads)
    write('projects.json', projects)
    write('expansions.json', expansions)
    write('updates.geojson', {'type':'FeatureCollection', 'features':[]})
    write('config.json', {'metadata':read(source, 'metadata.json'),
                         'colors':read(source, 'style.json')['lane_colors']})
    print(f'已提取 {len(roads["features"]):,} 条道路和 {len(projects)} 个依据项目。')


if __name__ == '__main__':
    main()
