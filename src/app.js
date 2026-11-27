import {dictionaries, supported, voiceLanguages} from './i18n.js';
import {localProjection, measureRoute, routePosition} from './geo.js';
import {createFlatMap, drawMiniMap} from './map-flat.js';

/* 頁面狀態、使用者偏好與資料來源集中在這裡，3D 模組在啟用時才載入。 */
const byId = id => document.getElementById(id);
const many = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const setIcon = (button, name) => button.querySelector('use').setAttribute('href','#i-' + name);
const icon = name => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden','true');
  const use = document.createElementNS(svg.namespaceURI,'use');
  use.setAttribute('href','#i-' + name);
  svg.append(use);
  return svg;
};
function preferences(key, value) {
  try {
    if (value === undefined) return localStorage.getItem('otaru:' + key);
    localStorage.setItem('otaru:' + key,value);
  } catch {
    // 隱私模式禁用儲存時，仍維持目前分頁的偏好。
  }
  return null;
}
const savedLanguage = preferences('language');
const state = {area:null,language:supported.includes(savedLanguage) ? savedLanguage : 'zh-Hant', night:preferences('night') === 'true',
  index:0, mode:'photo', photoIndex:0, flight:false, fullscreen:false, tour:null, speaking:false};
const t = (key, variables = {}) => (dictionaries[state.language][key] || key)
  .replace(/\{(\w+)\}/g,(_, name) => variables[name] ?? '');
const ids = ['experience','viewer','photo-layer','scene-photo','map-layer','map-render','map-markers','map-status','photo-mode',
  'map-mode','scene-credit','map-credit','photo-caption','caption-name','next-photo','photo-position','mini-map-button','mini-map',
  'map-tools','fly','flight-pad','tour-button','tour-bar','tour-pause','tour-status','tour-stop','progress','stop-number','category',
  'spot-name','spot-translation','spot-story','history-link','voice','voice-status','stops','announcement','route-count','language','night',
  'fullscreen','about-dialog','about-links','photo-credits','area-options','route-heading','route-kind'];
const ui = Object.fromEntries(ids.map(id => [id,byId(id)]));
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const coarse = window.matchMedia('(pointer: coarse)');
const number = n => String(n).padStart(2,'0');
const stopHere = () => places.stops[state.index];
const announce = text => { ui.announcement.textContent = text; };
let places, mapData, driver, mapLoading, mapFailed = false, cardButtons = [];
const areasById = new Map(), areaByStop = new Map(), markers = [];
const currentArea = () => areasById.get(state.area);
const selectedArea = () => areaByStop.get(stopHere().id);
const currentView = () => currentArea()?.view ?? places.overview;
const visibleIndices = () => currentArea()?.indices ?? places.stops.map((_,index) => index);
let route = [], segments = [], speech, speechTimer = 0, tourFrame = 0;
let pan = {x:0,y:0,scale:1,drag:null};

async function fetchJSON(file) {
  const response = await fetch(new URL('../data/' + file,import.meta.url));
  if (!response.ok) throw new Error(response.status + ': ' + file);
  return response.json();
}
let mapDataRequest;
function getMapData() {
  mapDataRequest ??= fetchJSON('map.json').then(result => {
    mapData = result;
    paintMini();
    return result;
  }).catch(() => {
    mapDataRequest = null;
    return null;
  });
  return mapDataRequest;
}

function label(element, key) {
  const text = t(key);
  element.setAttribute('aria-label',text);
  if (element.matches('button') && !element.textContent.trim()) element.title = text;
}

function syncLanguage() {
  document.documentElement.lang = state.language;
  document.title = t('title') + '｜OTARU GUIDE';
  ui.language.value = state.language;
  for (const element of many('[data-t]')) element.textContent = t(element.dataset.t);
  for (const element of many('[data-label]')) label(element,element.dataset.label);
  label(ui.progress,'tourProgress');
  if (!places) return;
  makeAreaOptions();
  makeCards();
  buildMarkers();
  renderAreaSummary();
  renderStop();
  renderTour();
  updateMode();
  updateTheme();
  updateFullscreen();
  updateSpeech();
  renderAbout();
}

/* 區域篩選與圖上區域標記共用同一套選取狀態。 */
function makeAreaOptions() {
  const selections = [[null,t('allAreas')], ...places.areas.map(area => [area.id,area.names[state.language]])];
  ui['area-options'].replaceChildren(...selections.map(([id,title]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'area-choice';
    button.dataset.area = id ?? '';
    button.textContent = title;
    button.addEventListener('click',() => selectArea(id));
    return button;
  }));
}

function renderAreaSummary() {
  const area = currentArea();
  for (const button of ui['area-options'].children) button.setAttribute('aria-pressed',String(button.dataset.area === (state.area ?? '')));
  ui['route-heading'].textContent = area ? t('areaSites',{name:area.names[state.language]}) : t('allSites');
  ui['route-count'].textContent = t('count',{n:visibleIndices().length});
  const kind = !area ? t('areaCount',{n:places.areas.length}) :
    area.minutes ? t('routeTime',{n:area.minutes}) : t(area.mode === 'walk' ? 'walking' : 'aerial');
  ui['route-kind'].querySelector('span').textContent = kind;
  setIcon(ui['route-kind'],area?.minutes ? 'clock' : area?.mode === 'aerial' ? 'plane' : 'route');
}

function syncMapScope() {
  const area = currentArea();
  route = area?.segments.flatMap((segment,index) => index ? segment.slice(1) : segment) ?? [];
  segments = measureRoute(area?.segments ?? [],localProjection(places.overview.center));
  duration = (area?.indices.length ?? 0) * DWELL_MS + segments.reduce((sum,_,index) => sum + moveDuration(index),0);
  driver?.setView(currentView(),route);
}

function selectArea(id,openMap = false) {
  if (id === state.area && !openMap) return;
  const mapWasOpen = state.mode === 'map';
  stopTour();
  setFlight(false);
  state.area = id;
  syncMapScope();
  makeCards();
  buildMarkers();
  renderAreaSummary();
  const first = currentArea()?.indices[0];
  if (first !== undefined && !visibleIndices().includes(state.index)) visit(first);
  else renderStop();
  renderTour();
  setMode(openMap || mapWasOpen ? 'map' : 'photo');
  if (openMap) ui['map-render'].focus({preventScroll:true});
}

function makeCards() {
  const cards = visibleIndices().map((index,position) => {
    const stop = places.stops[index];
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stop-card';
    const imageWrap = document.createElement('span');
    imageWrap.className = 'card-picture';
    const photo = document.createElement('img');
    photo.src = './assets/photos/' + stop.thumbnail;
    photo.alt = '';
    photo.loading = 'lazy';
    imageWrap.append(photo);
    const indexTag = document.createElement('span');
    indexTag.className = 'card-number';
    indexTag.textContent = number(position + 1);
    const line = document.createElement('span');
    line.className = 'card-line';
    const info = document.createElement('span');
    const name = document.createElement('strong');
    name.className = 'card-name';
    name.textContent = stop[state.language].name;
    const sub = document.createElement('span');
    sub.className = 'card-subtitle';
    sub.textContent = stop[state.language].subtitle;
    info.append(name,sub);
    if (!currentArea()) {
      const areaName = document.createElement('span');
      areaName.className = 'area-card-label';
      areaName.textContent = areaByStop.get(stop.id).names[state.language];
      info.append(areaName);
    }
    line.append(info,icon('right'));
    button.append(imageWrap,indexTag,line);
    button.addEventListener('click',() => visitManual(index,true));
    item.append(button);
    return {item,button,index};
  });
  cardButtons = cards;
  ui.stops.replaceChildren(...cards.map(card => card.item));
}

function buildMarkers() {
  const area = currentArea();
  const entries = area ? area.indices.map(index => {
    const stop = places.stops[index];
    return {index,name:stop[state.language].name,coordinates:stop.coordinates,onClick:() => visitManual(index,false,true)};
  }) : places.areas.map(region => ({
    areaId:region.id,name:region.names[state.language],coordinates:region.marker,
    count:region.indices.length,onClick:() => selectArea(region.id,true)
  }));
  const buttons = entries.map((entry,position) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = entry.areaId ? 'map-marker region-marker' : 'map-marker';
    button.hidden = true;
    const badge = document.createElement('b');
    badge.textContent = entry.areaId ? String(entry.count) : number(position + 1);
    const content = document.createElement('span');
    content.textContent = entry.name;
    button.setAttribute('aria-label',entry.areaId ? t('openArea',{name:entry.name}) + ' · ' + t('count',{n:entry.count}) :
      number(position + 1) + ' · ' + entry.name);
    button.title = entry.name;
    button.append(badge,content);
    button.addEventListener('click',entry.onClick);
    return {...entry,button};
  });
  // 引擎保留同一個標記陣列，因此換區時就地更新。
  markers.splice(0,markers.length,...buttons);
  ui['map-markers'].replaceChildren(...markers.map(marker => marker.button));
  updateMarkers();
}

function updateMarkers() {
  const areaId = selectedArea().id;
  for (const marker of markers) {
    const active = marker.areaId ? marker.areaId === areaId : marker.index === state.index;
    marker.button.classList.toggle('current',active);
    marker.button.setAttribute('aria-current',String(active));
  }
  driver?.refresh?.();
}

function renderStop() {
  const stop = stopHere();
  const content = stop[state.language];
  const indices = visibleIndices();
  ui['stop-number'].textContent = number(indices.indexOf(state.index) + 1) + ' / ' + number(indices.length);
  ui.category.textContent = content.type;
  ui['spot-name'].textContent = content.name;
  ui['caption-name'].textContent = content.name;
  const secondary = state.language === 'en' ? 'ja' : 'en';
  ui['spot-translation'].lang = secondary;
  ui['spot-translation'].textContent = stop[secondary].name;
  ui['spot-story'].textContent = content.story;
  ui['history-link'].href = stop.source;
  cardButtons.forEach(({button,index}) => button.setAttribute('aria-current',String(index === state.index)));
  updateMarkers();
  renderPhoto();
  paintMini();
}

function visit(index) {
  if (index !== state.index) stopSpeech();
  ui['voice-status'].hidden = true;
  state.index = index;
  state.photoIndex = 0;
  resetPhoto();
  renderStop();
  announce(stopHere()[state.language].name);
}

function visitManual(index, scroll = false, fromMap = false) {
  stopTour();
  stopSpeech();
  visit(index);
  setMode('photo');
  if (scroll) ui.experience.scrollIntoView({behavior:reduced.matches ? 'instant' : 'smooth',block:'nearest'});
  if (scroll || fromMap) ui['photo-mode'].focus({preventScroll:true});
  renderTour();
}

function visitAdjacent(offset) {
  const list = visibleIndices();
  const position = (list.indexOf(state.index) + offset + list.length) % list.length;
  visitManual(list[position]);
}

function photosHere() {
  const stop = stopHere();
  return state.night && stop.nightPhoto ? [stop.nightPhoto,...stop.photos] : stop.photos;
}

function renderPhoto() {
  const photos = photosHere();
  const slug = photos[state.photoIndex] || photos[0];
  const credit = places.photoCredits[slug];
  const image = ui['scene-photo'];
  const path = './assets/photos/' + credit.file;
  if (image.getAttribute('src') !== path) {
    ui['photo-layer'].classList.remove('missing');
    image.src = path;
  }
  image.alt = credit.alt?.[state.language] || stopHere()[state.language].name + ' · ' + stopHere()[state.language].subtitle;
  image.classList.toggle('native-night',slug === stopHere().nightPhoto || slug === 'asakusa');
  ui['next-photo'].hidden = photos.length < 2;
  ui['photo-position'].textContent = (state.photoIndex + 1) + ' / ' + photos.length;
  ui['scene-credit'].textContent = credit.author + ' · ' + credit.license;
  ui['scene-credit'].href = credit.source;
}

function clampPan() {
  const box = ui['photo-layer'];
  const edgeX = box.clientWidth * (pan.scale - 1) / 2;
  const edgeY = box.clientHeight * (pan.scale - 1) / 2;
  pan.x = Math.max(-edgeX,Math.min(edgeX,pan.x));
  pan.y = Math.max(-edgeY,Math.min(edgeY,pan.y));
  box.style.setProperty('--pan-x',pan.x + 'px');
  box.style.setProperty('--pan-y',pan.y + 'px');
  box.style.setProperty('--photo-zoom',pan.scale);
  box.classList.toggle('zoomed',pan.scale > 1);
}
function resetPhoto() { pan = {x:0,y:0,scale:1,drag:null}; clampPan(); }
function zoom(factor) {
  if (state.mode === 'map') {
    if (state.tour?.phase !== 'move') driver?.zoom(factor);
    return;
  }
  pan.scale = Math.min(3.5,Math.max(1,pan.scale * factor));
  clampPan();
}

function paintMini() {
  if (!mapData || !places || state.mode !== 'photo') return;
  const area = currentArea();
  const points = area ? area.indices.map(index => places.stops[index]) : places.areas.map(region => ({coordinates:region.marker}));
  const selected = area ? area.indices.indexOf(state.index) : places.areas.indexOf(selectedArea());
  drawMiniMap(ui['mini-map'],mapData,route,points,selected,state.night,currentView());
}

/* 3D 無法初始化或遺失 WebGL 內容時，維持相同路線、標記及控制介面。 */
async function ensureMap() {
  if (driver) return driver;
  if (mapLoading) return mapLoading;
  mapFailed = false;
  mapLoading = (async () => {
    const [data,buildings] = await Promise.all([getMapData(),fetchJSON('structures.json').catch(() => [])]);
    if (!data) throw new Error('地圖圖資未載入');
    const options = {container:ui['map-render'],data:{...data,buildings},markers,view:currentView()};
    const fallback = () => {
      driver?.dispose();
      state.flight = false;
      driver = createFlatMap(options);
      driver.setView(currentView(),route);
      if (state.tour?.phase === 'move') driver.beginTravel();
      driver.setNight(state.night);
      driver.setVisible(state.mode === 'map');
      updateMode();
    };
    try {
      const {createMap3D} = await import('./map-3d.js');
      driver = createMap3D({...options,onContextLost:fallback});
    } catch {
      fallback();
    }
    driver.setView(currentView(),route);
    driver.setNight(state.night);
    driver.setVisible(state.mode === 'map');
    if (state.tour?.phase === 'move') driver.beginTravel();
    updateMode();
    return driver;
  })().catch(() => {
    mapFailed = true;
    updateMode();
    return null;
  }).finally(() => { mapLoading = null; });
  return mapLoading;
}

function setMode(mode) {
  const changed = state.mode !== mode;
  state.mode = mode;
  if (mode === 'photo') {
    setFlight(false);
    driver?.setVisible(false);
    if (changed) resetPhoto();
    updateMode();
    paintMini();
    return;
  }
  updateMode();
  if (changed && !state.tour) driver?.reset();
  driver?.setVisible(true);
  ensureMap();
}

function updateMode() {
  const photo = state.mode === 'photo';
  ui.experience.dataset.mode = state.mode;
  ui['photo-layer'].hidden = !photo;
  ui['photo-caption'].hidden = !photo;
  ui['scene-credit'].hidden = !photo;
  ui['mini-map-button'].hidden = !photo;
  ui['map-layer'].hidden = photo;
  ui['map-credit'].hidden = photo || !mapData;
  ui['photo-mode'].setAttribute('aria-pressed',String(photo));
  ui['map-mode'].setAttribute('aria-pressed',String(!photo));
  ui['map-tools'].hidden = photo || !driver?.canFly || Boolean(state.tour);
  ui['flight-pad'].hidden = !state.flight;
  ui.fly.setAttribute('aria-pressed',String(state.flight));
  ui.fly.querySelector('span').textContent = t(state.flight ? 'exitFly' : 'fly');
  if (!photo) {
    const message = mapFailed ? 'mapError' : !driver ? 'loading' : !driver.canFly ? 'fallback' :
      state.flight ? (coarse.matches ? 'flyTouchHint' : 'flyHint') : currentArea() ? 'orbitHint' : 'cityMapHint';
    const text = t(message);
    ui['map-status'].dataset.status = message;
    if (ui['map-status'].textContent !== text) ui['map-status'].textContent = text;
  }
}

function setFlight(on) {
  state.flight = Boolean(on && driver?.canFly);
  driver?.setFlight?.(state.flight);
  updateMode();
  if (state.flight) ui['map-render'].focus({preventScroll:true});
}

function updateTheme() {
  document.body.classList.toggle('night',state.night);
  ui.night.setAttribute('aria-pressed',String(state.night));
  setIcon(ui.night,state.night ? 'sun' : 'moon');
  label(ui.night,state.night ? 'day' : 'night');
  driver?.setNight(state.night);
  paintMini();
}

function updateFullscreen() {
  state.fullscreen = document.fullscreenElement === ui.experience || ui.experience.classList.contains('pseudo-fullscreen');
  document.body.classList.toggle('fullscreen-active',state.fullscreen);
  ui.fullscreen.setAttribute('aria-pressed',String(state.fullscreen));
  setIcon(ui.fullscreen,state.fullscreen ? 'exit' : 'full');
  label(ui.fullscreen,state.fullscreen ? 'exitFull' : 'fullscreen');
  requestAnimationFrame(() => { clampPan(); paintMini(); });
}

async function toggleFullscreen() {
  if (ui.experience.classList.contains('pseudo-fullscreen')) ui.experience.classList.remove('pseudo-fullscreen');
  else if (document.fullscreenElement) await document.exitFullscreen();
  else {
    try {
      if (!ui.experience.requestFullscreen) throw new Error('瀏覽器未提供原生全螢幕');
      await ui.experience.requestFullscreen();
    } catch { ui.experience.classList.add('pseudo-fullscreen'); }
  }
  updateFullscreen();
}

/* 語音由裝置朗讀目前的導覽文字。視窗保留該句物件直到播放結束。 */
function updateSpeech() {
  setIcon(ui.voice,state.speaking ? 'stop' : 'headphones');
  ui.voice.querySelector('span').textContent = t(state.speaking ? 'stopVoice' : 'voice');
  ui.voice.setAttribute('aria-pressed',String(state.speaking));
}
function stopSpeech() {
  clearTimeout(speechTimer);
  if (speech) {
    speech.onend = null;
    speech.onerror = null;
    speech.onstart = null;
    window.speechSynthesis?.cancel();
  }
  speech = null;
  state.speaking = false;
  updateSpeech();
}
function voiceError() {
  stopSpeech();
  ui['voice-status'].textContent = t('voiceError');
  ui['voice-status'].hidden = false;
}
function speak() {
  if (state.speaking) { stopSpeech(); return; }
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) { voiceError(); return; }
  ui['voice-status'].hidden = true;
  const locale = voiceLanguages[state.language];
  const base = locale.split('-')[0];
  speech = new SpeechSynthesisUtterance(stopHere()[state.language].story);
  speech.lang = locale;
  const voices = speechSynthesis.getVoices();
  const voice = voices.find(candidate => candidate.lang.toLowerCase() === locale.toLowerCase()) ??
    voices.find(candidate => candidate.lang.toLowerCase().startsWith(base));
  if (voice) speech.voice = voice;
  else if (voices.length) { voiceError(); return; }
  speech.rate = .92;
  speech.onend = stopSpeech;
  speech.onerror = voiceError;
  speech.onstart = () => clearTimeout(speechTimer);
  state.speaking = true;
  updateSpeech();
  speechTimer = setTimeout(voiceError,4200);
  try { speechSynthesis.speak(speech); } catch { voiceError(); }
}

/* 路線以各段地面距離插值，抵達景點便切換至該站街景。 */
const DWELL_MS = 5600;
const moveDuration = i => Math.max(4200,Math.min(8500,segments[i].distance * 26));
let duration = 0;
function renderTour() {
  const tour = state.tour;
  ui['tour-bar'].hidden = !tour;
  ui['tour-button'].querySelector('span').textContent = t(tour ? 'endTour' : 'selectedTour',{name:selectedArea().names[state.language]});
  setIcon(ui['tour-button'],tour ? 'stop' : 'play');
  if (!tour) return;
  const key = tour.paused ? 'tourPaused' : tour.phase === 'move' ? 'tourMoving' : 'tourVisiting';
  const stopIndex = currentArea().indices[tour.index + Number(tour.phase === 'move')];
  const name = places.stops[stopIndex][state.language].name;
  const status = t(key,{name});
  if (ui['tour-status'].textContent !== status) ui['tour-status'].textContent = status;
  label(ui['tour-pause'],tour.paused ? 'resumeTour' : 'pauseTour');
  setIcon(ui['tour-pause'],tour.paused ? 'play' : 'pause');
  ui.progress.value = Math.min(1,(tour.completed + tour.elapsed) / duration);
}

function startTour() {
  if (state.tour) { stopTour(); return; }
  stopSpeech();
  if (!currentArea()) selectArea(selectedArea().id);
  state.tour = {phase:'stop',index:0,paused:false,last:0,elapsed:0,completed:0};
  visit(currentArea().indices[0]);
  setMode('photo');
  ensureMap();
  renderTour();
  ui.experience.scrollIntoView({behavior:reduced.matches ? 'instant' : 'smooth',block:'nearest'});
  tourFrame = requestAnimationFrame(advanceTour);
}

function stopTour(completed = false) {
  if (!state.tour) return;
  state.tour = null;
  cancelAnimationFrame(tourFrame);
  driver?.endTravel();
  setMode('photo');
  renderTour();
  if (completed) announce(t('tourComplete'));
}

function advanceTour(now) {
  const tour = state.tour;
  if (!tour || tour.paused) return;
  if (tour.last) tour.elapsed += Math.min(120,now - tour.last);
  tour.last = now;
  if (tour.phase === 'stop' && tour.elapsed >= DWELL_MS) {
    if (tour.index >= segments.length) { stopTour(true); return; }
    tour.phase = 'move';
    tour.completed += DWELL_MS;
    tour.elapsed -= DWELL_MS;
    if (!reduced.matches) {
      setMode('map');
      driver?.beginTravel();
    }
  }
  if (tour.phase === 'move') {
    const travelTime = moveDuration(tour.index);
    const fraction = Math.min(1,tour.elapsed / travelTime);
    const segment = segments[tour.index];
    if (!reduced.matches) driver?.setTravel(routePosition(segment,fraction),routePosition(segment,fraction + .018));
    if (fraction === 1) {
      driver?.endTravel();
      tour.phase = 'stop';
      tour.index++;
      tour.completed += travelTime;
      tour.elapsed -= travelTime;
      visit(currentArea().indices[tour.index]);
      setMode('photo');
    }
  }
  renderTour();
  tourFrame = requestAnimationFrame(advanceTour);
}

function pauseTour() {
  const tour = state.tour;
  if (!tour) return;
  tour.paused = !tour.paused;
  if (tour.paused) cancelAnimationFrame(tourFrame);
  else { tour.last = 0; tourFrame = requestAnimationFrame(advanceTour); }
  renderTour();
}

function renderAbout() {
  const link = (title,url) => {
    const a = document.createElement('a');
    a.textContent = title;
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  };
  const sources = [
    ['mapSource','https://www.openstreetmap.org/copyright'],
    ['citySource','https://www.city.otaru.lg.jp/docs/2020100900114/'],
    ['tourSource','https://otaru.gr.jp/guidemap/'],
    ['commonsSource','https://commons.wikimedia.org/wiki/Category:Otaru']
  ].map(([key,url]) => {
    const item = document.createElement('li');
    item.append(link(t(key),url));
    if (key === 'mapSource' && mapData) item.append(' · ' + t('mapSnapshot',{date:mapData.snapshot}));
    return item;
  });
  ui['about-links'].replaceChildren(...sources);
  const credits = Object.values(places.photoCredits).map(credit => {
    const item = document.createElement('li');
    item.append(link(credit.title,credit.source),' · ' + credit.author + ' · ');
    item.append(credit.licenseUrl ? link(credit.license,credit.licenseUrl) : credit.license);
    return item;
  });
  const changes = document.createElement('li');
  changes.textContent = t('creditChanges');
  ui['photo-credits'].replaceChildren(...credits,changes);
}

function bindEvents() {
  const click = (id,action) => byId(id).addEventListener('click',action);
  const selectMode = mode => {
    stopTour();
    setMode(mode);
  };
  click('photo-mode',() => selectMode('photo'));
  click('map-mode',() => selectMode('map'));
  click('mini-map-button',() => { selectMode('map'); ui['map-mode'].focus({preventScroll:true}); });
  click('fullscreen',toggleFullscreen);
  click('recenter',() => state.mode === 'map' ? driver?.reset() : resetPhoto());
  click('zoom-in',() => zoom(1.28));
  click('zoom-out',() => zoom(1 / 1.28));
  click('prev-stop',() => visitAdjacent(-1));
  click('next-stop',() => visitAdjacent(1));
  click('next-photo',() => {
    state.photoIndex = (state.photoIndex + 1) % photosHere().length;
    resetPhoto();
    renderPhoto();
  });
  click('night',() => {
    state.night = !state.night;
    preferences('night',String(state.night));
    state.photoIndex = 0;
    resetPhoto();
    renderPhoto();
    updateTheme();
  });
  click('voice',speak);
  click('fly',() => setFlight(!state.flight));
  click('tour-button',startTour);
  click('tour-stop',() => { stopTour(); ui['tour-button'].focus({preventScroll:true}); });
  click('tour-pause',pauseTour);
  click('close-about',() => ui['about-dialog'].close());

  ui.language.addEventListener('change',() => {
    if (!supported.includes(ui.language.value)) return;
    stopSpeech();
    ui['voice-status'].hidden = true;
    state.language = ui.language.value;
    preferences('language',state.language);
    syncLanguage();
  });
  many('[data-about]').forEach(button => button.addEventListener('click',() => {
    renderAbout(); ui['about-dialog'].showModal();
  }));
  ui['about-dialog'].addEventListener('click',event => {
    if (event.target === ui['about-dialog']) {
      const rect = ui['about-dialog'].getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) ui['about-dialog'].close();
    }
  });
  many('.nav a').forEach(link => link.addEventListener('click',() => {
    many('.nav a').forEach(item => item.classList.toggle('nav-active',item === link));
  }));
  document.addEventListener('fullscreenchange',updateFullscreen);
  document.addEventListener('keydown',event => {
    if (event.key !== 'Escape' || ui['about-dialog'].open) return;
    if (state.flight) { setFlight(false); ui.fly.focus(); }
    else if (ui.experience.classList.contains('pseudo-fullscreen')) toggleFullscreen();
  });

  const layer = ui['photo-layer'];
  ui['scene-photo'].addEventListener('load',() => layer.classList.remove('missing'));
  ui['scene-photo'].addEventListener('error',() => {
    layer.classList.add('missing');
    announce(t('photoMissing'));
  });
  layer.addEventListener('pointerdown',event => {
    if (!event.isPrimary || pan.scale === 1) return;
    layer.setPointerCapture(event.pointerId);
    pan.drag = [event.clientX - pan.x,event.clientY - pan.y];
  });
  layer.addEventListener('pointermove',event => {
    if (!pan.drag || !event.isPrimary) return;
    pan.x = event.clientX - pan.drag[0];
    pan.y = event.clientY - pan.drag[1];
    clampPan();
  });
  ['pointerup','pointercancel','lostpointercapture'].forEach(type => layer.addEventListener(type,() => { pan.drag = null; }));
  layer.addEventListener('keydown',event => {
    const offsets = {ArrowLeft:[-24,0],ArrowRight:[24,0],ArrowUp:[0,-24],ArrowDown:[0,24]};
    if (pan.scale <= 1 || !offsets[event.key]) return;
    event.preventDefault();
    pan.x += offsets[event.key][0];
    pan.y += offsets[event.key][1];
    clampPan();
  });
  layer.addEventListener('dblclick',() => zoom(pan.scale === 1 ? 1.7 : 1 / pan.scale));
  const observer = new ResizeObserver(() => { clampPan(); paintMini(); });
  observer.observe(ui.viewer);
  document.addEventListener('visibilitychange',() => {
    if (document.hidden && state.tour && !state.tour.paused) pauseTour();
  });

  // 觸控飛行方向鍵可長按，取消觸控或離開按鈕時立刻停止。
  many('[data-move]').forEach(button => {
    const action = button.dataset.move;
    const send = active => driver?.hold?.(action,active);
    button.addEventListener('pointerdown',event => {
      button.focus({preventScroll:true});
      button.setPointerCapture(event.pointerId);
      send(true);
    });
    ['pointerup','pointercancel','lostpointercapture','blur'].forEach(type => button.addEventListener(type,() => send(false)));
    button.addEventListener('keydown',event => {
      if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); send(true); }
    });
    button.addEventListener('keyup',() => send(false));
  });
}

async function initialize() {
  getMapData();
  try {
    places = await fetchJSON('places.json');
  } catch {
    syncLanguage();
    ui['spot-story'].textContent = t('loadError');
    return;
  }
  const stopIndexById = new Map(places.stops.map((stop,index) => [stop.id,index]));
  for (const area of places.areas) {
    area.indices = area.stops.map(id => stopIndexById.get(id));
    areasById.set(area.id,area);
    area.stops.forEach(id => areaByStop.set(id,area));
  }
  syncMapScope();
  bindEvents();
  syncLanguage();
}

initialize();

