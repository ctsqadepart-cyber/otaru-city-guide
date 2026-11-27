import {localProjection, placeMarkers, viewScale} from './geo.js';

/* 平面地圖與縮圖從同一份本機向量圖資繪製。 */
const DAY = {ocean:'#284f66',land:'#5d665f',water:'#37677a',park:'#59735a',road:'#8b8e81',building:'#a4a696',route:'#ffc47c'};
const NIGHT = {ocean:'#14263c',land:'#333d4e',water:'#224661',park:'#304c48',road:'#596678',building:'#657184',route:'#f5b975'};

function path(context, points, screen) {
  context.beginPath();
  points.forEach((point, index) => {
    const [x,y] = screen(point);
    if (index) context.lineTo(x,y);
    else context.moveTo(x,y);
  });
}

function draw(canvas, data, route, stops, view) {
  const context = canvas.getContext('2d');
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!context || !width || !height) return null;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(ratio,0,0,ratio,0,0);
  const swatch = view.night ? NIGHT : DAY;
  const projection = localProjection(data.origin);
  const [cx,cy] = projection(view.center);
  const verticalCenter = view.mini ? height * .42 : height * .52;
  const screen = coordinate => {
    const [x,z] = projection(coordinate);
    return [(x - cx) * view.scale + width / 2, (z - cy) * view.scale + verticalCenter, 0];
  };
  const fill = (points, color) => {
    path(context,points,screen);
    context.closePath();
    context.fillStyle = color;
    context.fill();
  };
  const far = view.scale < .18;
  const road = ([meters, bridge, points]) => {
    if (meters === 0) return fill(points,swatch.road);
    path(context,points,screen);
    context.lineWidth = Math.max(view.mini ? .45 : .65, meters * view.scale * (far ? 9 : 1));
    context.strokeStyle = swatch.road;
    context.stroke();
  };
  context.fillStyle = swatch.ocean;
  context.fillRect(0,0,width,height);
  fill(data.land,swatch.land);
  (data.islands || []).forEach(points => fill(points,swatch.land));
  data.parks.forEach(points => fill(points,swatch.park));
  const roads = far ? data.overviewRoads : data.roads;
  roads.filter(roadData => !roadData[1]).forEach(road);
  data.water.forEach(points => fill(points,swatch.water));
  roads.filter(roadData => roadData[1]).forEach(road);
  if (!view.mini && view.scale >= .2) {
    // 平面模式只繪製畫面周邊的建物，節省手機巡覽時的運算。
    for (const [,,footprint] of data.buildings || []) {
      const [x,y] = screen(footprint[0]);
      if (x > -90 && x < width + 90 && y > -90 && y < height + 90) fill(footprint,swatch.building);
    }
  }
  path(context,route,screen);
  context.strokeStyle = '#171c24';
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.lineWidth = view.mini ? 4 : 7;
  context.stroke();
  context.strokeStyle = swatch.route;
  context.lineWidth = view.mini ? 2 : 3.5;
  context.stroke();
  if (view.mini || view.travel) {
    const locations = view.mini ? stops.map(stop => stop.coordinates) : [view.travel];
    locations.forEach((point,index) => {
      const [x,y] = screen(point);
      const active = !view.mini || index === view.selected;
      context.beginPath();
      context.arc(x,y,active ? (view.mini ? 4.3 : 7) : 2.5,0,Math.PI * 2);
      context.fillStyle = active ? '#fff1d0' : swatch.route;
      context.fill();
      context.strokeStyle = '#2c2424';
      context.lineWidth = 1.1;
      context.stroke();
    });
  }
  return screen;
}

export function drawMiniMap(canvas, data, route, stops, selected, night, view) {
  const scale = viewScale(view,canvas.clientWidth * .86,canvas.clientHeight * .65);
  draw(canvas,data,route,stops,{center:view.center,scale,night,selected,mini:true});
}

export function createFlatMap({container, data, markers, view:initialView}) {
  const canvas = document.createElement('canvas');
  container.replaceChildren(canvas);
  let view = initialView, route = [];
  let center = view.center, zoom = 1, night = false, drag = null, travel = null;
  const scale = () => viewScale(view,canvas.clientWidth * .95,canvas.clientHeight * .86) * zoom;
  const repaint = () => {
    if (!container.clientWidth) return;
    const screen = draw(canvas,data,route,[],{center,scale:scale(),night,travel});
    if (screen) placeMarkers(markers,canvas.clientWidth,canvas.clientHeight,screen);
  };
  const pan = (x,y) => {
    const [minX,minY,maxX,maxY] = data.bounds;
    center = [
      Math.min(maxX,Math.max(minX,center[0] - x / (81_000 * scale()))),
      Math.min(maxY,Math.max(minY,center[1] + y / (111_195 * scale())))
    ];
    repaint();
  };
  const adjust = factor => {
    zoom = Math.max(.55, Math.min(5,zoom * factor));
    repaint();
  };
  canvas.addEventListener('pointerdown',event => {
    if (!event.isPrimary) return;
    canvas.setPointerCapture(event.pointerId);
    drag = [event.clientX,event.clientY];
  });
  canvas.addEventListener('pointermove',event => {
    if (!drag || !event.isPrimary) return;
    pan(event.clientX - drag[0],event.clientY - drag[1]);
    drag = [event.clientX,event.clientY];
  });
  ['pointerup','pointercancel','lostpointercapture'].forEach(type => canvas.addEventListener(type, () => { drag = null; }));
  canvas.addEventListener('wheel',event => {
    event.preventDefault();
    adjust(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  },{passive:false});
  const key = event => {
    const deltas = {ArrowLeft:[20,0],ArrowRight:[-20,0],ArrowUp:[0,20],ArrowDown:[0,-20]};
    if (!deltas[event.key]) return;
    event.preventDefault();
    pan(...deltas[event.key]);
  };
  container.addEventListener('keydown',key);
  const observer = new ResizeObserver(repaint);
  observer.observe(container);
  return {
    canFly:false,
    refresh:repaint,
    setVisible(visible) { if (visible) repaint(); },
    setNight(value) { night = value; repaint(); },
    zoom:adjust,
    setView(next,points) { view = next; route = points; center = view.center; zoom = 1; travel = null; repaint(); },
    reset() { center = view.center; zoom = 1; travel = null; repaint(); },
    beginTravel() {},
    setTravel(point) { center = point; travel = point; zoom = 1.3; repaint(); },
    endTravel() { travel = null; repaint(); },
    dispose() { observer.disconnect(); container.removeEventListener('keydown',key); canvas.remove(); }
  };
}

