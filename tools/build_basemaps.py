"""Render the checked-in Web Mercator basemaps from Natural Earth and Terrarium.

Requires Pillow, NumPy, GeoPandas and Shapely. Source archives and tiles are
downloaded separately; see README for their URLs and license information.
"""

import argparse
import json
import math
from pathlib import Path

import geopandas as gpd
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import box


ZOOM = 9
X0, X1 = 418, 432
Y0, Y1 = 195, 206
WIDTH, HEIGHT = (X1 - X0) * 256, (Y1 - Y0) * 256


def tile_lat(y):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2**ZOOM))))


WEST, EAST = (X0 / 2**ZOOM * 360 - 180, X1 / 2**ZOOM * 360 - 180)
NORTH, SOUTH = tile_lat(Y0), tile_lat(Y1)
CLIP = box(WEST, SOUTH, EAST, NORTH)


def point(lon, lat):
    x = ((lon + 180) / 360 * 2**ZOOM - X0) * 256
    lat = max(-85.05112878, min(85.05112878, lat))
    y = ((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2**ZOOM - Y0) * 256
    return (round(x), round(y))


def parts(geometry):
    if geometry.is_empty:
        return
    if hasattr(geometry, "geoms"):
        for item in geometry.geoms:
            yield from parts(item)
    else:
        yield geometry


def draw_polygons(draw, geometries, fill, hole_fill):
    for geometry in geometries:
        for item in parts(geometry.intersection(CLIP)):
            if item.geom_type != "Polygon":
                continue
            draw.polygon([point(*p) for p in item.exterior.coords], fill=fill)
            for hole in item.interiors:
                draw.polygon([point(*p) for p in hole.coords], fill=hole_fill)


def draw_lines(draw, geometries, color, width):
    for geometry in geometries:
        for item in parts(geometry.intersection(CLIP)):
            if item.geom_type in ("LineString", "LinearRing"):
                draw.line([point(*p) for p in item.coords], fill=color, width=width, joint="curve")


def read_shapes(folder, name):
    path = folder / f"ne_10m_{name}.shp"
    if not path.exists():
        raise FileNotFoundError(path)
    return gpd.read_file(path, bbox=(WEST, SOUTH, EAST, NORTH)).geometry


def render_street(sources, output):
    land = read_shapes(sources, "land")
    coast = read_shapes(sources, "coastline")
    lakes = read_shapes(sources, "lakes")
    rivers = read_shapes(sources, "rivers_lake_centerlines")

    land_mask = Image.new("L", (WIDTH, HEIGHT), 0)
    draw_polygons(ImageDraw.Draw(land_mask), land, 255, 0)

    image = Image.new("RGB", (WIDTH, HEIGHT), "#dcecf0")
    image.paste("#f4f2e8", mask=land_mask)
    draw = ImageDraw.Draw(image)
    draw_polygons(draw, lakes, "#dcecf0", "#f4f2e8")
    draw_lines(draw, rivers, "#afd0da", 2)
    draw_lines(draw, coast, "#a6c6c8", 2)
    image.save(output / "street.jpg", quality=89, optimize=True, subsampling=0)
    return land_mask


def read_elevation(folder):
    elevation = np.empty((HEIGHT, WIDTH), dtype=np.float32)
    for y in range(Y0, Y1):
        for x in range(X0, X1):
            path = folder / f"{x}_{y}.png"
            if not path.exists():
                raise FileNotFoundError(path)
            with Image.open(path) as source:
                rgb = np.asarray(source.convert("RGB"), dtype=np.float32)
            elevation[(y-Y0)*256:(y-Y0+1)*256, (x-X0)*256:(x-X0+1)*256] = (
                rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768
            )
    return elevation


def render_terrain(tiles, land_mask, output):
    elevation = read_elevation(tiles)
    # Terrarium stores metres. The pixel scale below approximates ground metres
    # near 36°N and is only used for visual hillshade, not elevation analysis.
    dy, dx = np.gradient(elevation, 247)
    normal = np.stack((-dx, -dy, np.ones_like(dx)), axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    sun = np.array([-0.5, -0.5, math.sqrt(0.5)], dtype=np.float32)
    shade = np.clip(0.55 + 0.55 * (normal @ sun), 0.56, 1.15)

    stops = [0, 80, 250, 600, 1100, 2000]
    colors = np.array([
        [231, 239, 212], [208, 225, 183], [180, 205, 151],
        [191, 181, 132], [159, 143, 112], [225, 218, 199],
    ])
    height = np.clip(elevation, 0, stops[-1])
    terrain = np.stack([np.interp(height, stops, colors[:, i]) for i in range(3)], axis=-1)
    terrain *= shade[:, :, None]
    sea = np.empty_like(terrain)
    sea[:] = [211, 231, 237]
    sea *= np.clip(1 + np.minimum(elevation, 0)[:, :, None] / 5000, 0.83, 1)
    land = np.asarray(land_mask) > 0
    rgb = np.where(land[:, :, None], terrain, sea).clip(0, 255).astype(np.uint8)
    Image.fromarray(rgb, "RGB").save(output / "terrain.jpg", quality=87, optimize=True, subsampling=0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--natural-earth", type=Path, required=True, help="directory containing ne_10m_*.shp")
    parser.add_argument("--terrarium", type=Path, required=True, help="directory containing x_y.png tiles")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    output = root / "assets"
    output.mkdir(exist_ok=True)
    land_mask = render_street(args.natural_earth, output)
    render_terrain(args.terrarium, land_mask, output)
    metadata = {"bounds": [[SOUTH, WEST], [NORTH, EAST]], "nativeZoom": ZOOM, "width": WIDTH, "height": HEIGHT}
    (root / "data" / "basemap.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Rendered {WIDTH} × {HEIGHT} basemaps; bounds {metadata['bounds']}")


if __name__ == "__main__":
    main()
