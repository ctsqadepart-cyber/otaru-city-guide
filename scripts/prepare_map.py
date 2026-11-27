"""從 OSM XML 取出小樽運河周邊常用向量圖層，供網站離線繪圖。"""
import argparse
import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

DEFAULT_SOURCE = "https://www.openstreetmap.org/api/0.6/map?bbox=140.993,43.195,141.010,43.2095"
BOUNDS = (140.994, 43.1951, 141.010, 43.2094)


def tags(element):
    """將 OSM tag 元素轉為字典。"""
    return {tag.attrib["k"]: tag.attrib["v"] for tag in element.findall("tag")}


def in_bounds(point):
    """判斷座標是否落在圖層保留範圍。"""
    west, south, east, north = BOUNDS
    return west <= point[0] <= east and south <= point[1] <= north


def estimate_height(info):
    """優先使用量測高度，再用樓層或用途估算公尺數。"""
    height = re.fullmatch(r"(\d+(?:\.\d+)?)(?:\s*m)?", info.get("height", ""))
    levels = re.fullmatch(r"(\d+(?:\.\d+)?)", info.get("building:levels", ""))
    if height:
        return min(85, max(2.5, float(height[1])))
    if levels:
        return min(85, max(2.5, 3.15 * float(levels[1])))
    return {"warehouse": 9, "industrial": 10, "garage": 3, "shed": 3, "apartments": 11}.get(info["building"], 6.3)


def export(xml_path, output, snapshot):
    """取出有完整節點的多邊形、道路、橋梁、綠地及海岸線。"""
    osm = ET.parse(xml_path).getroot()
    nodes = {
        node.attrib["id"]: [round(float(node.attrib["lon"]), 6), round(float(node.attrib["lat"]), 6)]
        for node in osm.findall("node")
    }
    data = {
        "snapshot": snapshot,
        "bounds": BOUNDS,
        "origin": [141.00136, 43.20113],
        "source": DEFAULT_SOURCE,
        "attribution": "© OpenStreetMap contributors",
        "license": "ODbL-1.0",
        "land": [], "water": [], "parks": [], "roads": [], "buildings": [],
    }
    roads = {
        "trunk": 12, "primary": 10, "secondary": 8, "tertiary": 7, "residential": 5.2, "unclassified": 5.5,
        "living_street": 4, "service": 3.3, "pedestrian": 3.4, "footway": 2, "path": 1.6, "steps": 1.5,
    }
    for way in osm.findall("way"):
        info = tags(way)
        ids = [node.attrib["ref"] for node in way.findall("nd")]
        points = [nodes.get(node_id) for node_id in ids]
        if len(points) < 2 or any(point is None for point in points):
            continue

        # 保留運河入口附近的港口海岸，沿外側補上超出畫面範圍的陸地邊界。
        if way.attrib["id"] == "131181018":
            start = min(range(len(points)), key=lambda i: math.dist(points[i], [141.008831, 43.195595]))
            end = min(range(len(points)), key=lambda i: math.dist(points[i], [141.007827, 43.210808]))
            data["land"] = [[141.015, 43.187], *points[start:end + 1], [141.011, 43.218], [140.985, 43.218], [140.985, 43.187]]
            continue
        if not any(in_bounds(point) for point in points):
            continue
        closed = len(points) >= 4 and ids[0] == ids[-1]
        highway = info.get("highway")
        if closed and info.get("building") not in (None, "no"):
            data["buildings"].append([estimate_height(info), info["building"], points])
        elif closed and info.get("natural") == "water":
            data["water"].append(points)
        elif closed and (info.get("leisure") in {"park", "garden"} or info.get("landuse") in {"grass", "forest", "recreation_ground"}):
            data["parks"].append(points)
        elif highway in roads and info.get("area") != "yes" and info.get("tunnel") != "yes":
            is_bridge = info.get("bridge") not in (None, "no")
            data["roads"].append([roads[highway], is_bridge, points])
        elif closed and info.get("man_made") == "bridge":
            data["roads"].append([0, True, points])
    if not data["land"] or not data["water"] or not data["buildings"]:
        raise ValueError("圖資缺少海岸、運河或建築，請檢查來源範圍。")
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf8")
    for layer in ("water", "parks", "roads", "buildings"):
        print(f"{layer}: {len(data[layer])}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("xml", type=Path, help="下載的 OSM XML 檔")
    parser.add_argument("--date", required=True, help="擷取日期，格式 YYYY-MM-DD")
    parser.add_argument("--output", type=Path, default=Path("data/map.json"))
    args = parser.parse_args()
    export(args.xml, args.output, args.date)

