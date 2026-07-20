import { BoatPreset } from '../types';
import { BOAT_WIDTH, BOW_NARROW_DIST, BASE_WIDTH, BASE_HEIGHT, DECK_WIDTH, ARM_WIDTH_THIN } from '../constants';
export const getMapStyle = (tileSize: number) => ({
  version: 8,
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: tileSize,
    }
  },
  layers: [{ id: 'esri-satellite-layer', type: 'raster', source: 'esri-satellite', minzoom: 0, maxzoom: 20 }]
});

export function getMetersPerPixel(latitude: number, zoom: number): number {
  return (Math.cos(latitude * Math.PI / 180) * 40075016.686) / Math.pow(2, zoom + 8) / 3;
}

// Sprawdza orientację trzech punktów (funkcja pomocnicza dla przecięć linii)
function ccw(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  return (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);
}

// Sprawdza, czy odcinek A-B przecina się z odcinkiem C-D
export function lineSegmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number
): boolean {
  return ccw(ax, ay, cx, cy, dx, dy) !== ccw(bx, by, cx, cy, dx, dy) &&
    ccw(ax, ay, bx, by, cx, cy) !== ccw(ax, ay, bx, by, dx, dy);
}

// Precyzyjne obliczanie najbliższego wektora do ściany (odcinka linii)
export function getClosestWallVector(px: number, py: number, polygons: number[][]) {
  let minDistance = Infinity;
  let closestX = px;
  let closestY = py;

  for (const poly of polygons) {
    if (poly.length < 6) continue;
    for (let i = 0; i < poly.length; i += 2) {
      const x1 = poly[i];
      const y1 = poly[i + 1];
      const nextIdx = (i + 2) % poly.length;
      const x2 = poly[nextIdx];
      const y2 = poly[nextIdx + 1];

      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) continue;

      // Rzutowanie punktu na odcinek (wyznaczanie współczynnika t)
      let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t)); // Ograniczenie do ram odcinka

      const nearestX = x1 + t * dx;
      const nearestY = y1 + t * dy;
      const dist = Math.hypot(px - nearestX, py - nearestY);

      if (dist < minDistance) {
        minDistance = dist;
        closestX = nearestX;
        closestY = nearestY;
      }
    }
  }

  return { dist: minDistance, x: closestX, y: closestY };
}

export function isPointInPolygon(x: number, y: number, poly: number[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; i += 2) {
    const xi = poly[i], yi = poly[i + 1];
    const xj = poly[j], yj = poly[j + 1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
    j = i;
  }
  return inside;
}

export function getSimBoatPoints(mpp: number, preset: BoatPreset = 'standard'): number[] {
  const isSmall = preset === 'small';
  const width = isSmall ? 1.25 : 1.85;
  const length = isSmall ? 4.0 : 5.5;
  const bowDist = isSmall ? 0.8 : 1.0;

  const bW = (width / 2) / mpp;
  const lenPixels = length / mpp;
  const narrowStart = (lenPixels / 2) - (bowDist / mpp);
  const smoothX = narrowStart + ((lenPixels / 2) - narrowStart) * 0.5;
  const smoothW = bW * 0.7;

  const xRear = -lenPixels / 2;
  const xBow = lenPixels / 2;

  return [
    xRear, -bW,
    narrowStart, -bW,
    smoothX, -smoothW,
    xBow, 0,
    smoothX, smoothW,
    narrowStart, bW,
    xRear, bW
  ];
}

export function generateBoomPoints(p1: { x: number, y: number }, p2: { x: number, y: number }, type: 'no-deck' | 'deck', mpp: number): number[] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const angle = Math.atan2(dy, dx);
  const length = Math.hypot(dx, dy);
  const bW = (BASE_WIDTH / 2) / mpp;
  const bH = BASE_HEIGHT / mpp;
  const dW = (type === 'deck' ? DECK_WIDTH / 2 : ARM_WIDTH_THIN / 2) / mpp;
  const rot = (x: number, y: number) => [
    p1.x + (x * Math.cos(angle) - y * Math.sin(angle)),
    p1.y + (x * Math.sin(angle) + y * Math.cos(angle))
  ];
  return [...rot(0, -bW), ...rot(bH, -dW), ...rot(length, -dW), ...rot(length, dW), ...rot(bH, dW), ...rot(0, bW)];
}

export function generateBoatPoints(p1: { x: number, y: number }, p2: { x: number, y: number }, mpp: number): number[] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const angle = Math.atan2(dy, dx);
  const length = Math.hypot(dx, dy);
  const bW = (BOAT_WIDTH / 2) / mpp;
  const narrowStart = Math.max(0, length - (BOW_NARROW_DIST / mpp));
  const smoothX = narrowStart + (length - narrowStart) * 0.5;
  const smoothW = bW * 0.7;
  const rot = (x: number, y: number) => [
    p1.x + (x * Math.cos(angle) - y * Math.sin(angle)),
    p1.y + (x * Math.sin(angle) + y * Math.cos(angle))
  ];
  return [
    ...rot(0, -bW),
    ...rot(narrowStart, -bW),
    ...rot(smoothX, -smoothW),
    ...rot(length, 0),
    ...rot(smoothX, smoothW),
    ...rot(narrowStart, bW),
    ...rot(0, bW)
  ];
}
