"""Convert the 16 DataV Shandong city polygons from GCJ-02 to approximate WGS84.

Download https://geo.datav.aliyun.com/areas_v3/bound/370000_full.json first.
Requires Shapely only for deriving the province outline from the city polygons.
"""

import argparse
import json
import math
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union


PI = math.pi
A = 6378245.0
EE = 0.00669342162296594323
SOURCE = "https://geo.datav.aliyun.com/areas_v3/bound/370000_full.json"


def lat_offset(x, y):
    value = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*math.sqrt(abs(x))
    value += (20*math.sin(6*x*PI) + 20*math.sin(2*x*PI)) * 2/3
    value += (20*math.sin(y*PI) + 40*math.sin(y/3*PI)) * 2/3
    return value + (160*math.sin(y/12*PI) + 320*math.sin(y*PI/30)) * 2/3


def lon_offset(x, y):
    value = 300 + x + 2*y + .1*x*x + .1*x*y + .1*math.sqrt(abs(x))
    value += (20*math.sin(6*x*PI) + 20*math.sin(2*x*PI)) * 2/3
    value += (20*math.sin(x*PI) + 40*math.sin(x/3*PI)) * 2/3
    return value + (150*math.sin(x/12*PI) + 300*math.sin(x/30*PI)) * 2/3


def wgs_to_gcj(lon, lat):
    dlat, dlon = lat_offset(lon - 105, lat - 35), lon_offset(lon - 105, lat - 35)
    rad = lat / 180 * PI
    magic = 1 - EE * math.sin(rad)**2
    root = math.sqrt(magic)
    dlat = dlat * 180 / ((A * (1-EE)) / (magic * root) * PI)
    dlon = dlon * 180 / (A / root * math.cos(rad) * PI)
    return lon + dlon, lat + dlat


def gcj_to_wgs(lon, lat):
    # Fixed-point inverse; this is a display alignment estimate, not surveying.
    wlon, wlat = lon, lat
    for _ in range(5):
        glon, glat = wgs_to_gcj(wlon, wlat)
        wlon += lon - glon
        wlat += lat - glat
    return [round(wlon, 6), round(wlat, 6)]


def convert_coords(value):
    if isinstance(value[0], (float, int)):
        return gcj_to_wgs(value[0], value[1])
    return [convert_coords(item) for item in value]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="downloaded 370000_full.json")
    args = parser.parse_args()
    source = json.loads(args.input.read_text())
    features = source["features"]
    if len(features) != 16 or any(item["properties"].get("level") != "city" for item in features):
        raise ValueError("Expected 16 DataV city features")

    cities = []
    for item in features:
        props = item["properties"]
        cities.append({
            "type": "Feature",
            "properties": {"adcode": props["adcode"], "name": props["name"],
                           "center": gcj_to_wgs(*props["center"])},
            "geometry": {"type": item["geometry"]["type"],
                         "coordinates": convert_coords(item["geometry"]["coordinates"])},
        })
    province_shape = unary_union([shape(item["geometry"]) for item in cities])
    province = {"type": "FeatureCollection", "features": [{
        "type": "Feature", "properties": {"adcode": 370000, "name": "山东省"},
        "geometry": mapping(province_shape),
    }]}
    metadata = {"source": SOURCE, "processing": "approximate GCJ-02 to WGS84",
                "note": "display background only; not a statutory boundary; redistribution terms not confirmed"}
    root = Path(__file__).resolve().parent.parent / "data"
    for name, collection in [("cities.geojson", {"type": "FeatureCollection", "features": cities}),
                             ("province.geojson", province)]:
        collection["metadata"] = metadata
        (root / name).write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")) + "\n")
    print("Converted 16 city polygons and derived one province outline")


if __name__ == "__main__":
    main()
