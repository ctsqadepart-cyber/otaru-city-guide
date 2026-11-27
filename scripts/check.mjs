/* 驗證六個區域的邊界、景點、路線，以及 Pages 會發布的各圖層。 */
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {dictionaries,supported} from '../src/i18n.js';
import {localProjection,measureRoute,routePosition} from '../src/geo.js';

const file = name => fileURLToPath(new URL('../' + name,import.meta.url));
const readJSON = name => JSON.parse(readFileSync(file(name),'utf-8'));
const {stops,areas,overview,photoCredits} = readJSON('data/places.json');
const map = readJSON('data/map.json');
const buildings = readJSON('data/structures.json');
const [west,south,east,north] = map.bounds;
const coordinate = pair => Array.isArray(pair) && pair.length === 2 &&
  pair.every(Number.isFinite) && pair[0] >= west && pair[0] <= east && pair[1] >= south && pair[1] <= north;
const validView = view => coordinate(view.center) &&
  [view.span,view.depth].every(value => Number.isFinite(value) && value >= 100);
const html = readFileSync(file('index.html'),'utf-8');
const isWebp = path => readFileSync(file('assets/photos/' + path)).toString('ascii',8,12) === 'WEBP';
const spotById = new Map(stops.map(stop => [stop.id,stop]));
assert(stops.length >= 2 && areas.length > 1 && validView(overview));
assert.equal(spotById.size,stops.length);
assert.equal(new Set(areas.map(area => area.id)).size,areas.length);
assert.deepEqual(areas.flatMap(area => area.stops),stops.map(stop => stop.id));

for (const stop of stops) {
  assert(coordinate(stop.coordinates) && stop.source.startsWith('https://'),stop.id);
  assert(isWebp(stop.thumbnail),stop.thumbnail);
  for (const language of supported) for (const key of ['name','type','story','subtitle']) assert(stop[language]?.[key],stop.id + '/' + language);
  assert(stop.photos.length > 0,stop.id);
  for (const photo of [...stop.photos,stop.nightPhoto].filter(Boolean)) assert(photoCredits[photo],photo);
}

const distances = [];
for (const area of areas) {
  assert(area.stops.length >= 2 && validView(area.view) && coordinate(area.marker),area.id);
  assert(['walk','aerial'].includes(area.mode));
  if (area.minutes !== undefined) assert(area.mode === 'walk' && Number.isFinite(area.minutes) && area.minutes > 0);
  for (const language of supported) assert(area.names[language],area.id + '/' + language);
  assert.equal(area.segments.length,area.stops.length - 1);
  area.segments.forEach((segment,index) => {
    assert(segment.length > 1 && segment.every(coordinate),area.id);
    assert.deepEqual(segment[0],spotById.get(area.stops[index]).coordinates);
    assert.deepEqual(segment.at(-1),spotById.get(area.stops[index + 1]).coordinates);
  });
  const measures = measureRoute(area.segments,localProjection(map.origin));
  measures.forEach(segment => {
    assert(segment.distance > 20,area.id);
    assert.deepEqual(routePosition(segment,0),segment.points[0]);
    const result = routePosition(segment,1);
    assert(result.every((value,index) => Math.abs(value - segment.points.at(-1)[index]) < 1e-9),area.id);
  });
  distances.push(area.id + ' ' + Math.round(measures.reduce((total,segment) => total + segment.distance,0)) + ' m');
}

for (const photo of Object.values(photoCredits)) {
  assert(isWebp(photo.file),photo.file);
  assert(photo.title && photo.author && photo.license && photo.source.startsWith('https://commons.wikimedia.org/'),photo.file);
  assert(photo.licenseUrl?.startsWith('https://creativecommons.org/') || photo.license === 'Public domain',photo.file);
}
for (const language of supported) {
  assert.deepEqual(Object.keys(dictionaries[language]).sort(),Object.keys(dictionaries['zh-Hant']).sort());
  for (const match of html.matchAll(/data-(?:t|label)="([^"]+)"/g)) assert(dictionaries[language][match[1]],match[1]);
}
for (const name of readdirSync(file('src')).filter(name => name.endsWith('.js'))) {
  const check = spawnSync(process.execPath,['--check',file('src/' + name)],{encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);
}
for (const name of ['index.html','assets/vendor/LICENSE','assets/vendor/three.module.js','assets/vendor/three.core.js',
  'assets/vendor/OrbitControls.js','.github/workflows/pages.yml','.nojekyll','啟動網站.cmd']) assert(existsSync(file(name)),name);
assert(map.land.length > 100 && map.water.length && map.overviewRoads.length > 50 && map.roads.length > 100 && buildings.length > 100);
console.log('驗證通過 · ' + areas.length + ' 區 · ' + stops.length + ' 個景點 · ' + supported.length + ' 種語言');
console.log('路線距離 · ' + distances.join(' · '));

