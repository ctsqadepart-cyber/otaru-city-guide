/* 將 WGS84 經緯度換成小樽附近的東向、南向公尺座標。 */
const METERS_PER_DEGREE = 111_195;
export function localProjection(origin) {
  const eastScale = METERS_PER_DEGREE * Math.cos(origin[1] * Math.PI / 180);
  return ([longitude, latitude]) => [(longitude - origin[0]) * eastScale, (origin[1] - latitude) * METERS_PER_DEGREE];
}

export function measureRoute(segments, project) {
  return segments.map(points => {
    const distances = [0];
    for (let i = 1; i < points.length; i++) {
      const [x, z] = project(points[i]);
      const [previousX, previousZ] = project(points[i - 1]);
      distances.push(distances[i - 1] + Math.hypot(x - previousX, z - previousZ));
    }
    return {points, distances, distance:distances.at(-1)};
  });
}

export function routePosition(segment, fraction) {
  const distance = Math.min(1, Math.max(0, fraction)) * segment.distance;
  const {points, distances} = segment;
  const index = Math.min(points.length - 1, Math.max(1, distances.findIndex(value => value >= distance)));
  const start = points[index - 1];
  const end = points[index];
  const step = distances[index] - distances[index - 1];
  const advance = step ? (distance - distances[index - 1]) / step : 0;
  return [start[0] + (end[0] - start[0]) * advance, start[1] + (end[1] - start[1]) * advance];
}

/* 地圖引擎共用可讀取、可點擊的 HTML 景點標記。 */
export function placeMarkers(markerNodes, width, height, projectScreen) {
  const occupied = [];
  markerNodes.forEach(({button, coordinates}) => {
    const [x, y, depth] = projectScreen(coordinates);
    button.hidden = depth > 1 || depth < -1 || x < 5 || x > width - 5 || y < 5 || y > height - 5;
    if (button.hidden) return;
    const boxWidth = button.offsetWidth;
    const boxHeight = button.offsetHeight;
    const half = boxWidth / 2;
    // 優先貼近地點；遇到相鄰標記則沿周圍小幅排列，讓每一站仍能點選。
    const offsets = [[0,0],[-boxWidth-4,0],[boxWidth+4,0],[0,-boxHeight-5],[0,boxHeight+5],[-boxWidth-4,boxHeight],[boxWidth+4,boxHeight]];
    const compact = width < 500;
    const reservedRight = compact ? 56 : 51;
    const boxes = offsets.map(([dx,dy]) => {
      const left = Math.max(4,Math.min(width - boxWidth - reservedRight,x + dx - half));
      const top = Math.max(compact ? 60 : 4,Math.min(height - boxHeight - 4,y + dy - boxHeight));
      return {left,top,right:left+boxWidth,bottom:top+boxHeight};
    });
    const chosen = boxes.find(box => occupied.every(used =>
      box.right + 4 < used.left || box.left - 4 > used.right || box.bottom + 4 < used.top || box.top - 4 > used.bottom
    )) || boxes[0];
    occupied.push(chosen);
    button.style.transform = 'translate(' + chosen.left + 'px,' + chosen.top + 'px)';
  });
}

/* 以景點在地面上的水平及垂直分布，計算目前容器需要的取景尺度。 */
export function viewScale(view, width, height) {
  const metersWide = view.span;
  const metersTall = view.depth ?? view.span * .68;
  return Math.min(width / metersWide,height / metersTall);
}

