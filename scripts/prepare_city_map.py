"""將 OSM 廣域圖和各景點 XML 快照整合成小樽全區的靜態向量圖資。"""
import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path

from prepare_map import estimate_height, tags

COAST_IDS = (648726675, 648726659, 648726662, 131181018, 131176093, 131176805, 1044749015)
BOUNDS = (140.784, 43.115, 141.257, 43.260)
ORIGIN = (141.005, 43.190)
ROAD_WIDTHS = {
    "motorway": 16, "trunk": 13, "primary": 10, "secondary": 8, "tertiary": 7,
    "residential": 5, "unclassified": 5, "living_street": 4, "service": 3.3,
    "pedestrian": 3.4, "footway": 2, "path": 1.6, "steps": 1.5,
}
DETAIL_BOXES = (
    (140.989, 43.185, 141.010, 43.2085), (141.005, 43.228, 141.019, 43.2405),
    (140.968, 43.1665, 140.981, 43.1835), (141.032, 43.128, 141.051, 43.1545),
    (141.151, 43.138, 141.174, 43.151), (140.899, 43.2015, 140.936, 43.2205),
    (140.843, 43.193, 140.888, 43.215),
)


def within(point, box):
    """測試座標是否位於指定描繪區域。"""
    return box[0] <= point[0] <= box[2] and box[1] <= point[1] <= box[3]


def xml_features(path):
    """利用 OSM 節點索引還原每條線的座標。"""
    root = ET.parse(path).getroot()
    nodes = {x.attrib["id"]: [round(float(x.attrib["lon"]), 6), round(float(x.attrib["lat"]), 6)] for x in root.findall("node")}
    for way in root.findall("way"):
        points = [nodes.get(n.attrib["ref"]) for n in way.findall("nd")]
        if len(points) >= 2 and all(point is not None for point in points):
            yield int(way.attrib["id"]), (tags(way), points)


def convert(overview_file, xml_files, date):
    """合併主要道路、海岸線、湖泊、綠地及各區附近的建物。"""
    raw = json.loads(overview_file.read_text(encoding="utf-8"))
    overview = {entry["id"]: (entry.get("tags", {}), [
        [round(p["lon"], 6), round(p["lat"], 6)] for p in entry["geometry"]
    ]) for entry in raw["elements"] if entry.get("type") == "way" and entry.get("geometry")}
    ways = dict(overview)
    for xml_file in xml_files:
        ways.update(xml_features(xml_file))
    coast = []
    for key in COAST_IDS:
        points = ways[key][1]
        if coast and coast[-1] != points[0]:
            raise ValueError(f"海岸線路徑 {key} 已變更，請更新整段海岸的 OSM 識別碼。")
        coast.extend(points if not coast else points[1:])
    if not coast:
        raise ValueError("未取得小樽海岸線。")
    data = {
        "origin": ORIGIN, "bounds": BOUNDS,
        "snapshot": date,
        "osmBase": raw.get("osm3s", {}).get("timestamp_osm_base"),
        "source": "https://wiki.openstreetmap.org/wiki/Overpass_API",
        "attribution": "© OpenStreetMap contributors", "license": "ODbL-1.0",
        "land": [*coast, [coast[-1][0], 42.94], [coast[0][0], 42.94]],
        "islands": [], "water": [], "parks": [], "roads": [], "overviewRoads": [], "buildings": [],
    }
    for key, (info, points) in ways.items():
        if not any(within(point, BOUNDS) for point in points):
            continue
        closed = len(points) >= 4 and points[0] == points[-1]
        detailed = any(within(points[0], box) or within(points[len(points) // 2], box) for box in DETAIL_BOXES)
        building = info.get("building")
        highway = info.get("highway")
        if closed and info.get("natural") == "coastline":
            data["islands"].append(points)
        elif closed and detailed and building not in (None, "no"):
            data["buildings"].append([estimate_height(info), building, points])
        elif closed and info.get("natural") == "water":
            data["water"].append(points)
        elif closed and (info.get("leisure") in {"park", "garden"} or info.get("landuse") in {"grass", "forest", "recreation_ground"} or info.get("natural") == "wood"):
            data["parks"].append(points)
        elif highway in ROAD_WIDTHS and info.get("area") != "yes" and info.get("tunnel") not in {"yes", "culvert"}:
            feature = [ROAD_WIDTHS[highway], info.get("bridge") not in (None, "no"), points]
            if detailed and info.get("access") != "private":
                data["roads"].append(feature)
            if key in overview and highway in {"motorway", "trunk", "primary", "secondary"}:
                data["overviewRoads"].append(feature)
        elif detailed and closed and info.get("man_made") == "bridge":
            data["roads"].append([0, True, points])
    if len(data["buildings"]) < 100 or len(data["overviewRoads"]) < 50 or not data["water"]:
        raise ValueError("廣域圖資不完整。")
    return data


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--overview", required=True, type=Path, help="Overpass 產生的廣域 JSON")
    cli.add_argument("--date", required=True, help="圖資擷取日期")
    cli.add_argument("--output", type=Path, default=Path("data/map.json"))
    cli.add_argument("--structures", type=Path, default=Path("data/structures.json"))
    cli.add_argument("--source-dir", type=Path, help="存放區域 XML 快照的資料夾")
    cli.add_argument("xml", nargs="*", type=Path, help="區域 OSM XML 檔案")
    args = cli.parse_args()
    xml = args.xml or (sorted(args.source_dir.glob("*.osm")) if args.source_dir else [])
    if not xml:
        cli.error("請指定區域 XML 檔案或 --source-dir。")
    result = convert(args.overview, xml, args.date)
    structures = result.pop("buildings")
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    args.structures.write_text(json.dumps(structures, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    for item in ("land", "islands", "water", "parks", "roads", "overviewRoads"):
        print(f"{item}: {len(result[item])}")
    print(f"buildings: {len(structures)}")

