"""
Convertit un raster (albédo, végétation ou LST) en PNG géolocalisé (EPSG:4326) pour l'affichage,
plus un GeoTIFF compact 16 bits pour la lecture précise côté navigateur.

Usage : python convert_raster.py <src.tif> <city> <kind> <out_dir>
  kind in {albedo, vegetation, lst}
"""
import sys
import os
import json
import numpy as np
from PIL import Image
import rasterio
from rasterio.warp import calculate_default_transform, reproject, Resampling

MAX_SIZE = 2400
COVERAGE_THRESHOLD = 0.4

PALETTES = {
    "albedo": {
        "stops": [(0.00, (10, 5, 5)), (0.15, (90, 10, 10)), (0.35, (170, 25, 15)),
                  (0.55, (225, 90, 15)), (0.75, (245, 165, 40)), (0.90, (255, 225, 90)),
                  (1.00, (255, 252, 225))],
        "scale": 10000, "alpha": 200,
    },
    "vegetation": {
        "stops": [(0.00, (247, 252, 245)), (0.25, (199, 233, 192)), (0.50, (116, 196, 118)),
                  (0.75, (35, 139, 69)), (1.00, (0, 68, 27))],
        "scale": 100, "alpha": 200,
    },
    "lst": {
        "stops": [(0.00, (20, 40, 130)), (0.30, (70, 130, 180)), (0.55, (250, 230, 120)),
                  (0.78, (230, 120, 40)), (1.00, (140, 10, 10))],
        "scale": 100, "alpha": 190,
    },
}
RANGES = {"albedo": (0.15, 0.40), "vegetation": (0.0, 42.0), "lst": (28.0, 53.0)}


def build_lut(stops, n=256):
    stops_pos = np.array([s[0] for s in stops])
    stops_col = np.array([s[1] for s in stops], dtype=np.float32)
    xs = np.linspace(0, 1, n)
    lut = np.zeros((n, 3), dtype=np.uint8)
    for c in range(3):
        lut[:, c] = np.clip(np.interp(xs, stops_pos, stops_col[:, c]), 0, 255).astype(np.uint8)
    return lut


def convert(src_path, city, kind, out_dir):
    vmin, vmax = RANGES[kind]
    palette = PALETTES[kind]

    with rasterio.open(src_path) as src:
        dst_crs = "EPSG:4326"
        transform, width, height = calculate_default_transform(src.crs, dst_crs, src.width, src.height, *src.bounds)
        scale = max(width, height) / MAX_SIZE
        if scale > 1:
            width = int(width / scale); height = int(height / scale)
            transform, width, height = calculate_default_transform(
                src.crs, dst_crs, src.width, src.height, *src.bounds, dst_width=width, dst_height=height)

        src_nodata = src.nodata

        dst_array = np.full((height, width), np.nan, dtype=np.float32)
        reproject(source=rasterio.band(src, 1), destination=dst_array,
                   src_transform=src.transform, src_crs=src.crs,
                   dst_transform=transform, dst_crs=dst_crs,
                   resampling=Resampling.average, src_nodata=src_nodata, dst_nodata=np.nan)

        src_arr = src.read(1)
        coverage_src = np.where(src_arr == src_nodata, 0.0, 1.0).astype(np.float32) if src_nodata is not None else np.ones(src_arr.shape, dtype=np.float32)
        coverage_dst = np.zeros((height, width), dtype=np.float32)
        reproject(source=coverage_src, destination=coverage_dst,
                   src_transform=src.transform, src_crs=src.crs,
                   dst_transform=transform, dst_crs=dst_crs, resampling=Resampling.average)

        valid = coverage_dst >= COVERAGE_THRESHOLD

        west, north = transform * (0, 0)
        east, south = transform * (width, height)
        bounds = [[south, west], [north, east]]

        norm = np.clip((dst_array - vmin) / (vmax - vmin), 0, 1)
        idx = np.nan_to_num(norm * 255).astype(np.uint8)
        lut = build_lut(palette["stops"])
        rgb = lut[idx]
        alpha = np.where(valid, palette["alpha"], 0).astype(np.uint8)
        rgba = np.dstack([rgb, alpha])

        os.makedirs(out_dir, exist_ok=True)
        png_path = os.path.join(out_dir, f"{city}_{kind}.png")
        Image.fromarray(rgba, mode="RGBA").save(png_path, optimize=True)

        meta_path = os.path.join(out_dir, f"{city}_{kind}.json")
        with open(meta_path, "w") as f:
            json.dump({"bounds": bounds, "width": width, "height": height, "vmin": vmin, "vmax": vmax}, f)

        SCALE_FACTOR = palette["scale"]
        NODATA_U16 = 0
        precise = np.where(valid, np.clip(np.nan_to_num(dst_array) * SCALE_FACTOR, 1, 65535), NODATA_U16).astype(np.uint16)
        precise_path = os.path.join(out_dir, f"{city}_{kind}_precise.tif")
        profile = {"driver": "GTiff", "dtype": "uint16", "nodata": NODATA_U16, "width": width, "height": height,
                   "count": 1, "crs": dst_crs, "transform": transform, "compress": "deflate", "predictor": 2,
                   "tiled": True, "blockxsize": 256, "blockysize": 256}
        with rasterio.open(precise_path, "w", **profile) as dst:
            dst.write(precise, 1)

        n_valid = int(valid.sum())
        pct = 100 * n_valid / valid.size
        mean_val = float(np.nanmean(dst_array[valid])) if n_valid else 0
        print(f"{city} {kind}: {width}x{height}px, {pct:.1f}% couverture, moyenne={mean_val:.3f}")
        return png_path, meta_path, precise_path


if __name__ == "__main__":
    src_path, city, kind, out_dir = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    convert(src_path, city, kind, out_dir)
