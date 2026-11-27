/* 選用維護工具。擷取開放圖資一次，瀏覽網站時不呼叫這些端點。 */
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const folder = resolve(process.argv[2] || 'map-sources');
const mapEndpoint = 'https://www.openstreetmap.org/api/0.6/map?bbox=';
const overpass = 'https://maps.mail.ru/osm/tools/overpass/api/interpreter';
const query = '[out:json][timeout:22];(way[natural=coastline](43.09,140.80,43.29,141.25);' +
  'way[highway~"^(motorway|trunk|primary|secondary)$"](43.09,140.81,43.27,141.23);' +
  'way[natural=water](43.128,141.01,43.16,141.06););out geom;';
const tiles = {
  canal:[140.993,43.195,141.010,43.2095], sakai:[140.9965,43.1883,141.010,43.1974],
  shukutsu:[141.005,43.231,141.019,43.240], tengu:[140.9638,43.167,140.9988,43.196],
  asari:[141.025,43.129,141.0585,43.156], zenibako:[141.150,43.139,141.176,43.151],
  shioya:[140.8995,43.2015,140.938,43.224], oshoro:[140.8345,43.1915,140.895,43.216]
};

async function save(name,url,prefix) {
  // 固定查詢範圍和來源網域，公開服務逾時或拒絕時直接顯示狀態。
  const response = await fetch(url,{
    signal:AbortSignal.timeout(40_000),redirect:'error',
    headers:{'User-Agent':'OtaruCityExplorer/1.0 (static travel map snapshot)'}
  });
  if (!response.ok) throw new Error(name + '：HTTP ' + response.status);
  const body = await response.text();
  if (body.length > 22_000_000 || !body.trimStart().startsWith(prefix)) throw new Error(name + '：圖資格式或大小異常');
  await writeFile(join(folder,name),body);
  console.log(name + ' 已儲存');
}

await mkdir(folder,{recursive:true});
await save('overview.json',overpass + '?data=' + encodeURIComponent(query),'{');
for (const [name,box] of Object.entries(tiles)) await save(name + '.osm',mapEndpoint + box.join(','),'<?xml');

