import * as THREE from 'three';
import {OrbitControls} from '../assets/vendor/OrbitControls.js';
import {localProjection, placeMarkers, viewScale} from './geo.js';

/* 以實際建築輪廓擠出簡化模型，並把同類幾何合併以減少手機的繪製負荷。 */
function polygon(points, project) {
  const shape = new THREE.Shape();
  points.forEach((point,index) => {
    const [x,z] = project(point);
    if (index) shape.lineTo(x,-z);
    else shape.moveTo(x,-z);
  });
  shape.closePath();
  return shape;
}

function flatPolygons(list, project, height, material) {
  const vertices = [];
  list.forEach(points => {
    const geometry = new THREE.ShapeGeometry(polygon(points,project)).toNonIndexed();
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) vertices.push(position.getX(i),height,position.getZ(i));
    geometry.dispose();
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  return new THREE.Mesh(geometry,material);
}

function ribbon(lines, project, elevation, color) {
  const points = [];
  for (const [width, coordinates] of lines) {
    for (let i = 1; i < coordinates.length; i++) {
      const [x1,z1] = project(coordinates[i - 1]);
      const [x2,z2] = project(coordinates[i]);
      const length = Math.hypot(x2 - x1,z2 - z1);
      if (length < .01) continue;
      const normalX = (z2 - z1) / length * width / 2;
      const normalZ = (x1 - x2) / length * width / 2;
      const a = [x1 + normalX,elevation,z1 + normalZ];
      const b = [x1 - normalX,elevation,z1 - normalZ];
      const c = [x2 + normalX,elevation,z2 + normalZ];
      const d = [x2 - normalX,elevation,z2 - normalZ];
      points.push(...a,...b,...c,...b,...d,...c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
  return new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));
}

function buildings(entries, project) {
  const positions = [], normals = [], colors = [];
  const roofs = [0xe1cfb1,0xbfc0ae,0xd5c5b6,0xc1c6c8,0xa6abb2,0xc99076,0x97a9a6].map(color => new THREE.Color(color));
  const stone = new THREE.Color(0xbeb39f);
  entries.forEach(([height, kind, points], index) => {
    const geometry = new THREE.ExtrudeGeometry(polygon(points,project),{depth:height,bevelEnabled:false,curveSegments:1});
    geometry.rotateX(-Math.PI / 2);
    const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
    const roof = kind === 'warehouse' ? roofs[5] : roofs[(index * 13 + Math.floor(index / 7)) % roofs.length];
    for (let i = 0; i < p.count; i++) {
      const ny = n.getY(i);
      positions.push(p.getX(i),p.getY(i) + .2,p.getZ(i));
      normals.push(n.getX(i),ny,n.getZ(i));
      const tint = ny > .5 ? roof : stone;
      colors.push(tint.r,tint.g,tint.b);
    }
    geometry.dispose();
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  return new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));
}

const FLIGHT_KEYS = {
  KeyW:'forward', ArrowUp:'forward', KeyS:'back', ArrowDown:'back', KeyA:'left', ArrowLeft:'left',
  KeyD:'right', ArrowRight:'right', KeyE:'up', KeyQ:'down'
};
const COLOR = {
  day:{sky:0x5a7786,ocean:0x365f72,land:0x68736c,water:0x417d91,park:0x648364,roads:0x929383,bridge:0xb6aca0,light:0xfff0d5,ambient:0xe0eaff},
  night:{sky:0x14253e,ocean:0x163047,land:0x303b49,water:0x254f69,park:0x3d5755,roads:0x586071,bridge:0x7d7e82,light:0xaccdff,ambient:0x8faeee}
};

export function createMap3D({container,data,markers,view:initialView,onContextLost}) {
  const renderer = new THREE.WebGLRenderer({antialias:true,powerPreference:'default'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,1.65));
  renderer.domElement.setAttribute('aria-hidden','true');
  container.replaceChildren(renderer.domElement);
  const project = localProjection(data.origin);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.FogExp2(0x5a7786,.00048);
  const camera = new THREE.PerspectiveCamera(44,1,1,6300);
  const controls = new OrbitControls(camera,renderer.domElement);
  controls.minDistance = 45;
  controls.maxDistance = 1750;
  controls.maxPolarAngle = Math.PI * .475;
  controls.enableDamping = true;
  controls.zoomSpeed = .9;
  controls.listenToKeyEvents(container);

  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(270_000,270_000),new THREE.MeshBasicMaterial());
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -1.7;
  scene.add(ocean);
  const material = () => new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  const land = flatPolygons([data.land,...(data.islands || [])],project,0,material());
  const parks = flatPolygons(data.parks,project,.07,material());
  const water = flatPolygons(data.water,project,.19,material());
  const regularRoads = ribbon(data.roads.filter(([,bridge]) => !bridge).map(([width,,points]) => [width,points]),project,.12,COLOR.day.roads);
  const bridgeRoads = ribbon(data.roads.filter(([width,bridge]) => bridge && width > 0).map(([width,,points]) => [width,points]),project,1.05,COLOR.day.bridge);
  const decks = flatPolygons(data.roads.filter(([width]) => width === 0).map(entry => entry[2]),project,1,material());
  // 廣域道路用較寬線條，在縮小時仍可辨識城市各區的相對位置。
  const overviewRoads = ribbon(data.overviewRoads.map(([width,,points]) => [width * 11,points]),project,.75,COLOR.day.roads);
  const routes = new THREE.Group();
  const structures = new THREE.Group();
  const tileSize = 1200;
  const buildingTiles = new Map();
  for (const entry of data.buildings) {
    const [x,z] = project(entry[2][0]);
    const cell = Math.floor(x / tileSize) + '/' + Math.floor(z / tileSize);
    if (!buildingTiles.has(cell)) buildingTiles.set(cell,{entries:[],mesh:null});
    buildingTiles.get(cell).entries.push(entry);
  }
  const limits = [project([data.bounds[0],data.bounds[3]]),project([data.bounds[2],data.bounds[1]])];
  const sun = new THREE.DirectionalLight(0xfff0d5,2.40);
  sun.position.set(-350,740,260);
  const sky = new THREE.HemisphereLight(0xe0eaff,0x7e7068,1.22);
  scene.add(land,parks,water,regularRoads,overviewRoads,bridgeRoads,decks,routes,structures,sun,sky);
  const traveler = new THREE.Mesh(new THREE.SphereGeometry(5,14,8),new THREE.MeshBasicMaterial({color:0xffe4ad}));
  traveler.visible = false;
  scene.add(traveler);

  let visible = false, flying = false, traveling = false, needsRender = true, viewLaidOut = false, frameId = 0, lastTime = 0;
  let yaw = 0, pitch = 0, drag = null, view = initialView;
  const motion = new Set();
  const keys = new Set();
  const target = new THREE.Vector3();
  const cameraStart = new THREE.Vector3();
  const screen = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const orientation = new THREE.Euler(0,0,0,'YXZ');
  const look = () => camera.rotation.set(pitch,yaw,0,'YXZ');
  const markDirty = () => { needsRender = true; };

  function reset() {
    const [x,z] = project(view.center);
    const width = container.clientWidth || 880, height = container.clientHeight || 460;
    const wide = view.span > 4500;
    const heightInMeters = height / viewScale(view,width,height);
    const distance = heightInMeters / (2 * Math.tan(THREE.MathUtils.degToRad(22))) * (wide ? 1.06 : 1.12);
    controls.target.set(x,0,z);
    controls.minDistance = Math.min(60,view.span / 14);
    controls.maxDistance = Math.max(1700,distance * 1.65);
    camera.fov = 44;
    camera.near = wide ? 7 : 1;
    camera.far = Math.max(8000,distance * 5);
    camera.updateProjectionMatrix();
    scene.fog.density = wide ? .27 / distance : .00036;
    cameraStart.set(...(wide ? [0,1,.07] : [.32,.84,.52])).setLength(distance);
    camera.position.copy(controls.target).add(cameraStart);
    camera.lookAt(controls.target);
    if (flying) {
      orientation.setFromQuaternion(camera.quaternion,'YXZ');
      yaw = orientation.y;
      pitch = orientation.x;
    } else if (!traveling) controls.update();
    markDirty();
  }

  function resize() {
    const width = container.clientWidth, height = container.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width,height,false);
    if (!flying && !traveling && !viewLaidOut) {
      reset();
      viewLaidOut = true;
    }
    markDirty();
  }

  function setNight(isNight) {
    const scheme = isNight ? COLOR.night : COLOR.day;
    scene.background.set(scheme.sky);
    scene.fog.color.set(scheme.sky);
    ocean.material.color.set(scheme.ocean);
    land.material.color.set(scheme.land);
    water.material.color.set(scheme.water);
    parks.material.color.set(scheme.park);
    regularRoads.material.color.set(scheme.roads);
    overviewRoads.material.color.set(scheme.roads);
    bridgeRoads.material.color.set(scheme.bridge);
    decks.material.color.set(scheme.bridge);
    sun.color.set(scheme.light);
    sun.intensity = isNight ? .72 : 1.45;
    sky.color.set(scheme.ambient);
    sky.intensity = isNight ? .68 : 1.23;
    markDirty();
  }

  function move(delta) {
    const pressed = action => motion.has(action) || [...keys].some(key => FLIGHT_KEYS[key] === action);
    const forward = Number(pressed('forward')) - Number(pressed('back'));
    const side = Number(pressed('right')) - Number(pressed('left'));
    const vertical = Number(pressed('up')) - Number(pressed('down'));
    if (!forward && !side && !vertical) return;
    const distance = delta * Math.min(3900,46 + camera.position.y * .28) / Math.max(1,Math.hypot(forward,side,vertical));
    camera.position.x = THREE.MathUtils.clamp(camera.position.x + (Math.cos(yaw) * side - Math.sin(yaw) * forward) * distance,limits[0][0],limits[1][0]);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z + (-Math.sin(yaw) * side - Math.cos(yaw) * forward) * distance,limits[0][1] - 2500,limits[1][1] + 2500);
    camera.position.y = THREE.MathUtils.clamp(camera.position.y + vertical * distance,10,Math.max(1200,cameraStart.length() * 1.32));
    markDirty();
  }

  // 在靠近地面時才建立附近建物的幾何，已建立的圖塊交給視錐剔除。
  function updateBuildings() {
    const altitude = camera.position.y;
    const near = altitude < 2750;
    structures.visible = near;
    overviewRoads.visible = !near;
    regularRoads.visible = near;
    if (!near) return;
    const focus = traveling ? traveler.position : flying ? camera.position : controls.target;
    const reach = Math.min(4200,Math.max(1200,altitude * 1.95));
    const startX = Math.floor((focus.x - reach) / tileSize), endX = Math.floor((focus.x + reach) / tileSize);
    const startZ = Math.floor((focus.z - reach) / tileSize), endZ = Math.floor((focus.z + reach) / tileSize);
    for (let x = startX; x <= endX; x++) for (let z = startZ; z <= endZ; z++) {
      const tile = buildingTiles.get(x + '/' + z);
      if (tile && !tile.mesh) {
        tile.mesh = buildings(tile.entries,project);
        structures.add(tile.mesh);
      }
    }
  }

  function render(time) {
    if (!visible) return;
    const delta = Math.min(.05,(time - lastTime) / 1000 || 0);
    lastTime = time;
    if (flying) move(delta);
    else if (!traveling) controls.update(delta);
    if (needsRender && container.clientWidth && container.clientHeight) {
      // 廣域高空視角提高近裁切距離，避免海平面與沿岸地表互相閃爍。
      const near = Math.max(.7,camera.position.y * .015);
      if (Math.abs(near - camera.near) > .03) {
        camera.near = near;
        camera.updateProjectionMatrix();
      }
      updateBuildings();
      renderer.render(scene,camera);
      const width = container.clientWidth, height = container.clientHeight;
      placeMarkers(markers,width,height,coordinate => {
        const [x,z] = project(coordinate);
        const p = screen.set(x,view.span > 4500 ? 0 : 13,z).project(camera);
        return [(p.x + 1) * width / 2,(1 - p.y) * height / 2,p.z];
      });
      needsRender = false;
    }
    frameId = requestAnimationFrame(render);
  }

  function setFlight(on) {
    if (on === flying) return;
    motion.clear();
    keys.clear();
    drag = null;
    flying = on;
    controls.enabled = !on && !traveling;
    if (on) {
      orientation.setFromQuaternion(camera.quaternion,'YXZ');
      yaw = orientation.y;
      pitch = orientation.x;
    } else if (!traveling) {
      camera.getWorldDirection(direction);
      const distance = direction.y < -.03 ? Math.min(controls.maxDistance,camera.position.y / -direction.y) : view.span * .23;
      controls.target.copy(camera.position).addScaledVector(direction,distance);
      controls.update();
    }
    markDirty();
  }

  const keydown = event => {
    if (!flying || !FLIGHT_KEYS[event.code]) return;
    keys.add(event.code);
    event.preventDefault();
  };
  const keyup = event => { keys.delete(event.code); };
  const clearMotion = () => { motion.clear(); keys.clear(); drag = null; };
  const ground = renderer.domElement;
  ground.addEventListener('pointerdown', event => {
    if (!flying || !event.isPrimary) return;
    ground.setPointerCapture(event.pointerId);
    container.focus({preventScroll:true});
    drag = [event.clientX,event.clientY];
  });
  ground.addEventListener('pointermove',event => {
    if (!flying || !drag || !event.isPrimary) return;
    yaw -= (event.clientX - drag[0]) * .005;
    pitch = THREE.MathUtils.clamp(pitch - (event.clientY - drag[1]) * .005,-1.52,.78);
    look();
    markDirty();
    drag = [event.clientX,event.clientY];
  });
  ['pointerup','pointercancel','lostpointercapture'].forEach(name => ground.addEventListener(name, () => { drag = null; }));
  ground.addEventListener('webglcontextlost',event => {
    event.preventDefault();
    onContextLost();
  },{once:true});
  container.addEventListener('keydown',keydown);
  container.addEventListener('focusout',clearMotion);
  window.addEventListener('keyup',keyup);
  window.addEventListener('blur',clearMotion);
  controls.addEventListener('change',markDirty);
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  reset();
  setNight(false);

  return {
    canFly:true,
    setVisible(on) {
      if (on === visible) return;
      visible = on;
      if (on) {
        resize();
        lastTime = performance.now();
        frameId = requestAnimationFrame(render);
      } else {
        clearMotion();
        cancelAnimationFrame(frameId);
      }
    },
    setNight,reset,setFlight,refresh:markDirty,
    setView(next,points) {
      view = next;
      viewLaidOut = Boolean(container.clientWidth);
      for (const child of [...routes.children]) {
        child.geometry.dispose();
        child.material.dispose();
        routes.remove(child);
      }
      if (points.length > 1) {
        const width = Math.max(5.8,view.span / 145);
        routes.add(ribbon([[width * 1.52,points]],project,1.2,0x51402d),ribbon([[width,points]],project,1.27,0xffc579));
      }
      traveler.scale.setScalar(Math.max(1,view.span / 1000));
      reset();
    },
    hold(action,active) { if (active) motion.add(action); else motion.delete(action); },
    zoom(factor) {
      if (flying) {
        camera.fov = THREE.MathUtils.clamp(camera.fov / factor,24,68);
        camera.updateProjectionMatrix();
      } else {
        direction.copy(camera.position).sub(controls.target);
        const length = THREE.MathUtils.clamp(direction.length() / factor,controls.minDistance,controls.maxDistance);
        camera.position.copy(controls.target).add(direction.setLength(length));
        controls.update();
      }
      markDirty();
    },
    beginTravel() {
      traveling = true;
      setFlight(false);
      controls.enabled = false;
      traveler.visible = true;
    },
    setTravel(point,ahead) {
      const [x,z] = project(point);
      const [aheadX,aheadZ] = project(ahead);
      traveler.position.set(x,5.5,z);
      target.set(x + (aheadX - x) * .5,2,z + (aheadZ - z) * .5);
      const height = THREE.MathUtils.clamp(view.span * .19,165,2550);
      camera.position.set(x + height * .64,height,z + height * .70);
      camera.lookAt(target);
      markDirty();
    },
    endTravel() {
      traveling = false;
      controls.enabled = !flying;
      traveler.visible = false;
      reset();
    },
    dispose() {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      controls.dispose();
      container.removeEventListener('keydown',keydown);
      container.removeEventListener('focusout',clearMotion);
      window.removeEventListener('keyup',keyup);
      window.removeEventListener('blur',clearMotion);
      scene.traverse(object => {
        object.geometry?.dispose();
        object.material?.dispose();
      });
      renderer.dispose();
      ground.remove();
    }
  };
}

