import {useState, useEffect, useCallback, useRef} from 'react';
import Map from 'react-map-gl/maplibre';
import {Stage, Layer, Line, Circle, Group, Arrow} from 'react-konva';
import 'maplibre-gl/dist/maplibre-gl.css';
import Konva from 'konva';
import {Marker, Popup} from 'react-map-gl/maplibre';

// Stałe wymiary (w metrach)
const BASE_WIDTH = 1.25;
const BASE_HEIGHT = 0.8;
const DECK_WIDTH = 0.6;
const ARM_WIDTH_THIN = 0.1;

// Stałe łodzi
const BOAT_WIDTH = 1.85;
const BOW_NARROW_DIST = 1.0;
const BOAT_LEN = 5.5;

declare global {
  interface Window {
    api: {
      getPortDetails: (portId: number) => Promise<{
        success: boolean;
        port?: any;
        shapes?: any[];
        message?: string;
      }>;
      savePortData: (payload: any) => Promise<{
        success: boolean;
        message: string;
        portId?: number
      }>;
      getPorts: (bounds: {
        minLng: number;
        minLat: number;
        maxLng: number;
        maxLat: number;
      }) => Promise<{
        success: boolean;
        ports: any[];
        message?: string
      }>;
    };
  }
}

const getMapStyle = (tileSize: number) => ({
  version: 8,
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: tileSize,
    }
  },
  layers: [{id: 'esri-satellite-layer', type: 'raster', source: 'esri-satellite', minzoom: 0, maxzoom: 20}]
});

interface EditorState {
  polygons: number[][];
  startPoint: { x: number, y: number, rotation: number } | null;
  activePolyIdx: number;
}

function getClosestWallVector(px: number, py: number, polygons: number[][]) {
  let minDist = Infinity;
  let closestX = 0;
  let closestY = 0;

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
      const lensq = dx * dx + dy * dy;
      if (lensq === 0) continue;

      let t = ((px - x1) * dx + (py - y1) * dy) / lensq;
      t = Math.max(0, Math.min(1, t));

      const cx = x1 + t * dx;
      const cy = y1 + t * dy;

      const dist = Math.hypot(px - cx, py - cy);
      if (dist < minDist) {
        minDist = dist;
        closestX = cx;
        closestY = cy;
      }
    }
  }
  return { dist: minDist, x: closestX, y: closestY };
}

function App() {
  type Step = 0 | 1 | 2 | 3 | 4;
  const [step, setStep] = useState<Step>(0);
  const [viewState, setViewState] = useState({longitude: 18.66, latitude: 54.40, zoom: 8});

  type EditorMode = 'mapping' | 'simulation';

  const [waitingForMap, setWaitingForMap] = useState(false);
  const [pendingStep, setPendingStep] = useState<Step | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('mapping');
  const [tileSize, setTileSize] = useState<number>(256);
  const [ports, setPorts] = useState<any[]>([]);
  const [selectedPort, setSelectedPort] = useState<any>(null);
  const [polygons, setPolygons] = useState<number[][]>([[]]);
  const [activePolyIdx, setActivePolyIdx] = useState<number>(0);
  const [startPoint, setStartPoint] = useState<EditorState['startPoint']>(null);

  const [creationStart, setCreationStart] = useState<{
    x: number,
    y: number,
    mode: 'no-deck' | 'deck' | 'boat'
  } | null>(null);

  const [undoStack, setUndoStack] = useState<EditorState[]>([]);
  const [redoStack, setRedoStack] = useState<EditorState[]>([]);

  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({x: 0, y: 0});
  const [isPanning, setIsPanning] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [dimensions, setDimensions] = useState({width: window.innerWidth, height: window.innerHeight});

  // --- PARAMETRY ŚRODOWISKOWE I DIZAJN ŚRUBY ---
  const [windDir, setWindDir] = useState<number>(0);
  const [windSpeed, setWindSpeed] = useState<number>(0);
  const [propHandedness, setPropHandedness] = useState<'right' | 'left'>('right');

  const windDirRef = useRef(0);
  const windSpeedRef = useRef(0);
  const propHandednessRef = useRef<'right' | 'left'>('right');

  useEffect(() => { windDirRef.current = windDir; }, [windDir]);
  useEffect(() => { windSpeedRef.current = windSpeed; }, [windSpeed]);
  useEffect(() => { propHandednessRef.current = propHandedness; }, [propHandedness]);

  // --- STANY I REFY SYMULACYJNE (Zsynchronizowane źródła prawdy) ---
  const [simBoat, setSimBoat] = useState<{ x: number; y: number; rotation: number } | null>(null);
  const [throttle, setThrottle] = useState<number>(0);
  const [rudder, setRudder] = useState<number>(0);
  const [isSteeringWithMouse, setIsSteeringWithMouse] = useState(false);
  const [showMapBackground, setShowMapBackground] = useState<boolean>(true);

  const simThrottleRef = useRef(0);
  const simRudderRef = useRef(0);
  const currentRPMRef = useRef(0);

  const simStateRef = useRef({
    x: 0,
    y: 0,
    rotation: 0,
    u: 0,
    v: 0,
    r: 0
  });

  const keysPressed = useRef<Set<string>>(new Set());

  const handleSave = async () => {
    if (!startPoint) {
      alert("Dodaj punkt startowy przed zapisem!");
      return;
    }
    const payload = {
      location: { lng: viewState.longitude, lat: viewState.latitude },
      zoom: viewState.zoom,
      quality: tileSize,
      startPoint: startPoint,
      polygons: polygons.filter(poly => poly.length >= 6)
    };
    try {
      const response = await window.api.savePortData(payload);
      if (response && (response as any).success) {
        alert("Pomyślnie zapisano projekt w bazie!");
        setStep(0);
      } else {
        alert("Błąd zapisu: " + ((response as any).message || "Nieznany błąd"));
      }
    } catch (error) {
      console.error("Błąd podczas komunikacji z bazą:", error);
      alert("Wystąpił błąd krytyczny podczas zapisu.");
    }
  };

  const fetchVisiblePorts = async (view: any) => {
    const bounds = {
      minLng: view.longitude - 2,
      maxLng: view.longitude + 2,
      minLat: view.latitude - 2,
      maxLat: view.latitude + 2
    };
    const res = await window.api.getPorts(bounds);
    if (res.success) setPorts(res.ports);
  };

  const loadPortForSimulation = async (portId: number) => {
    try {
      const res = await window.api.getPortDetails(portId);
      if (!res.success || !res.port) {
        alert(res.message || 'Nie udało się pobrać portu');
        return;
      }
      const { port, shapes } = res;
      setViewState({ longitude: port.center_lng, latitude: port.center_lat, zoom: port.zoom_level });
      setTileSize(port.tile_quality);
      setStartPoint(port.start_point_json);
      const loadedPolygons = (shapes ?? []).map((s: any) => s.raw_points);
      setPolygons(loadedPolygons.length > 0 ? loadedPolygons : [[]]);
      setActivePolyIdx(0);
      setUndoStack([]);
      setRedoStack([]);
      setStageScale(1);
      setStagePos({ x: 0, y: 0 });
      setEditorMode('simulation');
      setPendingStep(2);
      setWaitingForMap(true);
    } catch (err) {
      console.error(err);
      alert('Błąd ładowania portu');
    }
  };

  useEffect(() => {
    if (step === 0) fetchVisiblePorts(viewState);
  }, [step]);

  useEffect(() => {
    const handleResize = () => setDimensions({width: window.innerWidth, height: window.innerHeight});
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getMetersPerPixel = useCallback(() => {
    const latitude = viewState.latitude;
    const zoom = viewState.zoom;
    return (Math.cos(latitude * Math.PI / 180) * 40075016.686) / Math.pow(2, zoom + 8) / 3;
  }, [viewState.latitude, viewState.zoom]);

  const getCurrentState = useCallback((): EditorState => ({
    polygons: JSON.parse(JSON.stringify(polygons)),
    startPoint: startPoint ? {...startPoint} : null,
    activePolyIdx
  }), [polygons, startPoint, activePolyIdx]);

  const saveHistory = useCallback(() => {
    setUndoStack(prev => [...prev, getCurrentState()]);
    setRedoStack([]);
  }, [getCurrentState]);

  const resetSimulation = useCallback(() => {
    if (startPoint) {
      simStateRef.current = {
        x: startPoint.x,
        y: startPoint.y,
        rotation: startPoint.rotation,
        u: 0,
        v: 0,
        r: 0
      };
      setSimBoat({
        x: startPoint.x,
        y: startPoint.y,
        rotation: startPoint.rotation
      });
    }
    simThrottleRef.current = 0;
    simRudderRef.current = 0;
    currentRPMRef.current = 0;
    setThrottle(0);
    setRudder(0);
  }, [startPoint]);

  useEffect(() => {
    if (step === 4) {
      resetSimulation();
    }
  }, [step, resetSimulation]);

  useEffect(() => {
    if (step !== 4) return;
    const handleKeyDown = (e: KeyboardEvent) => { keysPressed.current.add(e.key.toLowerCase()); };
    const handleKeyUp = (e: KeyboardEvent) => { keysPressed.current.delete(e.key.toLowerCase()); };
    const handleWindowWheel = (e: WheelEvent) => { e.preventDefault(); };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('wheel', handleWindowWheel, { passive: false });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('wheel', handleWindowWheel);
      keysPressed.current.clear();
    };
  }, [step]);

  const isPointInPolygon = (x: number, y: number, poly: number[]) => {
    let inside = false;
    for (let i = 0, j = poly.length - 2; i < poly.length; i += 2) {
      const xi = poly[i], yi = poly[i + 1];
      const xj = poly[j], yj = poly[j + 1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
      j = i;
    }
    return inside;
  };

  const getSimBoatPoints = () => {
    const mpp = getMetersPerPixel();
    const bW = (BOAT_WIDTH / 2) / mpp;
    const length = (BOAT_LEN) / mpp;
    const narrowStart = (length / 2) - (BOW_NARROW_DIST / mpp);
    const smoothX = narrowStart + ((length / 2) - narrowStart) * 0.5;
    const smoothW = bW * 0.7;

    const xRear = -length / 2;
    const xBow = length / 2;

    return [
      xRear, -bW,
      narrowStart, -bW,
      smoothX, -smoothW,
      xBow, 0,
      smoothX, smoothW,
      narrowStart, bW,
      xRear, bW
    ];
  };

  useEffect(() => {
    if (step !== 4) return;

    let animId: number;
    let lastTime = performance.now();

    const updatePhysics = () => {
      const now = performance.now();
      let dt = (now - lastTime) / 1000;
      lastTime = now;

      if (dt > 0.1) dt = 0.1;

      // 1. Obsługa wejścia za pomocą referencji o wysokiej częstotliwości (zapobiega blokowaniu manetki)
      let keysChanged = false;
      if (keysPressed.current.has('w')) {
        simThrottleRef.current = Math.min(100, simThrottleRef.current + 60 * dt);
        keysChanged = true;
      }
      if (keysPressed.current.has('s')) {
        simThrottleRef.current = Math.max(-50, simThrottleRef.current - 60 * dt);
        keysChanged = true;
      }
      if (keysChanged) {
        setThrottle(Math.round(simThrottleRef.current));
      }

      let rudderChanged = false;
      if (keysPressed.current.has('a') || keysPressed.current.has('arrowleft')) {
        simRudderRef.current = Math.max(-45, simRudderRef.current - 70 * dt);
        rudderChanged = true;
      }
      if (keysPressed.current.has('d') || keysPressed.current.has('arrowright')) {
        simRudderRef.current = Math.min(45, simRudderRef.current + 70 * dt);
        rudderChanged = true;
      }
      if (rudderChanged) {
        setRudder(Math.round(simRudderRef.current));
      }

      const state = simStateRef.current;
      const mpp = getMetersPerPixel();
      const psi = (state.rotation * Math.PI) / 180;

      // --- EFEKT A: INERCJA OBROTOWA SILNIKA ---
      const targetRPM = simThrottleRef.current;
      const rpmInertiaCoeff = 1.8;
      currentRPMRef.current += (targetRPM - currentRPMRef.current) * rpmInertiaCoeff * dt;
      if (currentRPMRef.current > 100) currentRPMRef.current = 100;
      if (currentRPMRef.current < -50) currentRPMRef.current = -50;
      const currentRPM = currentRPMRef.current;

      // --- EFEKT B: MODEL PŁYTKIEJ WODY ---
      const m = 1000;
      const Iz = 2500;

      const mx = 100 * 1.8;
      const my = 800 * 2.2;
      const Jz = 1500 * 2.0;

      const Mx = m + mx;
      const My = m + my;
      const Itotal = Iz + Jz;

      const windDirRad = (windDirRef.current * Math.PI) / 180;
      const Vc = 0.02 * windSpeedRef.current;
      const Vcx_glob = Vc * Math.cos(windDirRad);
      const Vcy_glob = Vc * Math.sin(windDirRad);

      const uc = Vcx_glob * Math.cos(psi) + Vcy_glob * Math.sin(psi);
      const vc = -Vcx_glob * Math.sin(psi) + Vcy_glob * Math.cos(psi);

      const ur = state.u - uc;
      const vr = state.v - vc;

      const XH = -85 * ur * Math.abs(ur);
      const YH = -1500 * vr * Math.abs(vr);
      const NH = -4800 * state.r * Math.abs(state.r);

      // --- EFEKT C: EFEKT BRZEGOWY ---
      let X_bank = 0;
      let Y_bank = 0;
      let N_bank = 0;

      const halfLenPixels = (BOAT_LEN / 2) / mpp;
      const bowX = state.x + halfLenPixels * Math.cos(psi);
      const bowY = state.y + halfLenPixels * Math.sin(psi);
      const sternX = state.x - halfLenPixels * Math.cos(psi);
      const sternY = state.y - halfLenPixels * Math.sin(psi);

      const bowWall = getClosestWallVector(bowX, bowY, polygons);
      const sternWall = getClosestWallVector(sternX, sternY, polygons);

      const bowDistM = bowWall.dist * mpp;
      const sternDistM = sternWall.dist * mpp;
      const maxBankDist = 5.0;

      if (ur > 0.1) {
        if (bowDistM < maxBankDist && bowDistM > 0.1) {
          let vX_bow = bowX - bowWall.x;
          let vY_bow = bowY - bowWall.y;
          const vLen = Math.hypot(vX_bow, vY_bow);
          if (vLen > 0) {
            vX_bow /= vLen; vY_bow /= vLen;
            const F_bow_mag = 1200 * (ur * ur) * (1.0 / bowDistM - 1.0 / maxBankDist);
            const F_bow_x = F_bow_mag * (vX_bow * Math.cos(psi) + vY_bow * Math.sin(psi));
            const F_bow_y = F_bow_mag * (-vX_bow * Math.sin(psi) + vY_bow * Math.cos(psi));
            X_bank += F_bow_x;
            Y_bank += F_bow_y;
            N_bank += F_bow_y * 2.2;
          }
        }

        if (sternDistM < maxBankDist && sternDistM > 0.1) {
          let vX_stern = sternWall.x - sternX;
          let vY_stern = sternWall.y - sternY;
          const vLen = Math.hypot(vX_stern, vY_stern);
          if (vLen > 0) {
            vX_stern /= vLen; vY_stern /= vLen;
            const F_stern_mag = 900 * (ur * ur) * (1.0 / sternDistM - 1.0 / maxBankDist);
            const F_stern_x = F_stern_mag * (vX_stern * Math.cos(psi) + vY_stern * Math.sin(psi));
            const F_stern_y = F_stern_mag * (-vX_stern * Math.sin(psi) + vY_stern * Math.cos(psi));
            X_bank += F_stern_x;
            Y_bank += F_stern_y;
            N_bank += F_stern_y * (-2.2);
          }
        }
      }

      // --- SILNIK I NAPĘD ---
      const maxThrustForward = 3800;
      const maxThrustBackward = 1800;
      let XP = 0;
      if (currentRPM >= 0) {
        XP = (currentRPM / 100) * maxThrustForward;
      } else {
        XP = (currentRPM / 50) * maxThrustBackward;
      }

      const propSign = propHandednessRef.current === 'right' ? 1 : -1;
      const YP = -0.7 * currentRPM * propSign;
      const NP = YP * (-2.2);

      // --- PŁETWA STEROWA ---
      const deltaRad = (simRudderRef.current * Math.PI) / 180;
      const VR2 = (ur * ur) + Math.max(0, currentRPM) * 0.35;
      const YR = -22.0 * VR2 * Math.sin(deltaRad);
      const XR = -22.0 * VR2 * (1 - Math.cos(deltaRad));
      const NR = YR * (-2.2);

      // --- AERODYNAMIKA ---
      const Uglob_x = state.u * Math.cos(psi) - state.v * Math.sin(psi);
      const Uglob_y = state.u * Math.sin(psi) + state.v * Math.cos(psi);
      const Vawx_glob = (windSpeedRef.current * Math.cos(windDirRad)) - Uglob_x;
      const Vawy_glob = (windSpeedRef.current * Math.sin(windDirRad)) - Uglob_y;

      const Uaw = Vawx_glob * Math.cos(psi) + Vawy_glob * Math.sin(psi);
      const Vaw = -Vawx_glob * Math.sin(psi) + Vawy_glob * Math.cos(psi);
      const Vrw2 = (Uaw * Uaw) + (Vaw * Vaw);
      const gammaRw = Math.atan2(Vaw, Uaw);

      const XW = 0.5 * 1.2 * 1.5 * Vrw2 * Math.cos(gammaRw);
      const YW = 0.5 * 1.2 * 4.0 * Vrw2 * Math.sin(gammaRw);
      const NW = YW * 0.4;

      const XTotal = XH + XP + XR + XW + X_bank;
      const YTotal = YH + YP + YR + YW + Y_bank;
      const NTotal = NH + NP + NR + NW + N_bank;

      const dot_u = (XTotal + My * state.v * state.r) / Mx;
      const dot_v = (YTotal - Mx * state.u * state.r) / My;
      const dot_r = NTotal / Itotal;

      const next_u = state.u + dot_u * dt;
      const next_v = state.v + dot_v * dt;
      const next_r = state.r + dot_r * dt;

      const nextRotation = state.rotation + (next_r * (180 / Math.PI)) * dt;
      const radNext = (nextRotation * Math.PI) / 180;

      const speedX_m = next_u * Math.cos(radNext) - next_v * Math.sin(radNext);
      const speedY_m = next_u * Math.sin(radNext) + next_v * Math.cos(radNext);

      const nextX = state.x + (speedX_m * dt) / mpp;
      const nextY = state.y + (speedY_m * dt) / mpp;

      const localPts = getSimBoatPoints();
      const cosR = Math.cos(radNext);
      const sinR = Math.sin(radNext);
      let collisionDetected = false;

      for (let i = 0; i < localPts.length; i += 2) {
        const lx = localPts[i];
        const ly = localPts[i + 1];
        const wx = nextX + (lx * cosR - ly * sinR);
        const wy = nextY + (lx * sinR + ly * cosR);

        for (const poly of polygons) {
          if (poly.length < 6) continue;
          if (isPointInPolygon(wx, wy, poly)) {
            collisionDetected = true;
            break;
          }
        }
        if (collisionDetected) break;
      }

      if (collisionDetected) {
        simStateRef.current = {
          ...state,
          rotation: nextRotation,
          u: 0,
          v: 0,
          r: 0
        };
      } else {
        simStateRef.current = {
          x: nextX,
          y: nextY,
          rotation: nextRotation,
          u: next_u,
          v: next_v,
          r: next_r
        };
      }

      setSimBoat({
        x: simStateRef.current.x,
        y: simStateRef.current.y,
        rotation: simStateRef.current.rotation
      });

      animId = requestAnimationFrame(updatePhysics);
    };

    animId = requestAnimationFrame(updatePhysics);
    return () => cancelAnimationFrame(animId);
  }, [step, polygons, getMetersPerPixel]);

  const generateBoomPoints = (p1: { x: number, y: number }, p2: { x: number, y: number }, type: 'no-deck' | 'deck') => {
    const mpp = getMetersPerPixel();
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
  };

  const generateBoatPoints = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
    const mpp = getMetersPerPixel();
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const angle = Math.atan2(dy, dx);
    const length = Math.hypot(dx, dy);
    const bW = (BOAT_WIDTH / 2) / mpp;
    const narrowStart = Math.max(0, length - (BOW_NARROW_DIST / mpp));
    const smoothX = narrowStart + (length - narrowStart) * 0.5;
    const smoothW = bW * 0.7;
    const rot = (x, y) => [
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
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const currentState = getCurrentState();
    const prevState = undoStack[undoStack.length - 1];
    setRedoStack(prev => [...prev, currentState]);
    setPolygons(prevState.polygons);
    setStartPoint(prevState.startPoint);
    setActivePolyIdx(prevState.activePolyIdx);
    setUndoStack(prev => prev.slice(0, -1));
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const currentState = getCurrentState();
    const nextState = redoStack[redoStack.length - 1];
    setUndoStack(prev => [...prev, currentState]);
    setPolygons(nextState.polygons);
    setStartPoint(nextState.startPoint);
    setActivePolyIdx(nextState.activePolyIdx);
    setRedoStack(prev => prev.slice(0, -1));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) {
          e.preventDefault();
          handleRedo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack, redoStack, polygons, startPoint, activePolyIdx]);

  const resetEditorState = () => {
    setPolygons([[]]);
    setActivePolyIdx(0);
    setStartPoint(null);
    setUndoStack([]);
    setRedoStack([]);
  };

  const handleStageMouseDown = (e: any) => {
    const nativeEvent = e.evt;
    const stage = e.target.getStage();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const x = (pointer.x - stagePos.x) / stageScale;
    const y = (pointer.y - stagePos.y) / stageScale;

    if (nativeEvent.button === 2) {
      setIsPanning(true);
      return;
    }

    if (nativeEvent.button === 0) {
      const isShiftAlt = nativeEvent.shiftKey && nativeEvent.altKey;
      const isCtrlAlt = (nativeEvent.ctrlKey || nativeEvent.metaKey) && nativeEvent.altKey;
      const isShiftCtrl = nativeEvent.shiftKey && (nativeEvent.ctrlKey || nativeEvent.metaKey);

      if (isShiftCtrl || isShiftAlt || isCtrlAlt) {
        setCreationStart({
          x, y,
          mode: isShiftCtrl ? 'boat' : (isShiftAlt ? 'deck' : 'no-deck')
        });
        return;
      }

      if (creationStart) {
        saveHistory();
        let pts: number[];
        if (creationStart.mode === 'boat') {
          pts = generateBoatPoints({x: creationStart.x, y: creationStart.y}, {x, y});
        } else {
          pts = generateBoomPoints({x: creationStart.x, y: creationStart.y}, {x, y}, creationStart.mode);
        }

        let newPolygons = [...polygons];
        if (newPolygons.length === 1 && newPolygons[0].length === 0) newPolygons = [pts];
        else newPolygons.push(pts);

        setPolygons(newPolygons);
        setActivePolyIdx(newPolygons.length - 1);
        setCreationStart(null);
        return;
      }

      if (nativeEvent.ctrlKey && !nativeEvent.shiftKey) {
        saveHistory();
        setStartPoint({x, y, rotation: 0});
        return;
      }

      if (e.target instanceof Konva.Circle || e.target instanceof Konva.Arrow) return;
      saveHistory();
      const newPolygons = [...polygons];
      const activePoints = [...newPolygons[activePolyIdx]];

      if (nativeEvent.shiftKey && activePoints.length > 0) {
        newPolygons.push([x, y]);
        setPolygons(newPolygons);
        setActivePolyIdx(newPolygons.length - 1);
        return;
      }

      let minIndex = -1;
      let minDistance = Infinity;
      if (activePoints.length >= 4) {
        for (let i = 0; i < activePoints.length; i += 2) {
          const x1 = activePoints[i], y1 = activePoints[i + 1];
          const nextIdx = (i + 2) % activePoints.length;
          const x2 = activePoints[nextIdx], y2 = activePoints[nextIdx + 1];
          const dx = x2 - x1, dy = y2 - y1;
          const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
          const nearestX = x1 + Math.max(0, Math.min(1, t)) * dx;
          const nearestY = y1 + Math.max(0, Math.min(1, t)) * dy;
          const dist = Math.hypot(x - nearestX, y - nearestY);
          if (dist < minDistance) {
            minDistance = dist;
            minIndex = i + 2;
          }
        }
      }
      const HIT_DISTANCE = 5 / stageScale;
      if (minDistance <= HIT_DISTANCE && minIndex !== -1) activePoints.splice(minIndex, 0, x, y);
      else activePoints.push(x, y);

      newPolygons[activePolyIdx] = activePoints;
      setPolygons(newPolygons);
    }
  };

  if (step === 0) {
    return (
      <div style={{width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column'}}>
        <header style={{ height: '60px', background: '#1a1a1a', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <h2>Moje Porty</h2>
        </header>
        <div style={{flex: 1, position: 'relative'}}>
          <Map
            {...viewState}
            onMove={evt => { setViewState(evt.viewState); fetchVisiblePorts(evt.viewState); }}
            mapStyle={getMapStyle(256) as any}
            style={{width: '100%', height: '100%'}}
            dragRotate={false}
            onRender={() => {
              if (!waitingForMap) return;
              if (pendingStep === null) return;
              setStep(pendingStep);
              setPendingStep(null);
              setWaitingForMap(false);
            }}
          >
            {ports.map(port => (
              <Marker key={port.id} longitude={port.center_lng} latitude={port.center_lat} onClick={e => { e.originalEvent.stopPropagation(); setSelectedPort(port); }}>
                <div style={{cursor: 'pointer', fontSize: '24px'}}>🚩</div>
              </Marker>
            ))}
            {selectedPort && (
              <Popup longitude={selectedPort.center_lng} latitude={selectedPort.center_lat} anchor="bottom" onClose={() => setSelectedPort(null)}>
                <div style={{padding: '5px', textAlign: 'center'}}>
                  <button onClick={() => loadPortForSimulation(selectedPort.id)} style={{ background: '#007bff', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}>
                    Przygotuj symulację
                  </button>
                </div>
              </Popup>
            )}
          </Map>
        </div>
        <footer style={{ height: '80px', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button onClick={() => setStep(1)} style={{ padding: '15px 40px', fontSize: '18px', cursor: 'pointer', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px', fontWeight: 'bold' }}>
            Mapuj nowy port
          </button>
        </footer>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div style={{width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column'}}>
        <header style={{ height: '70px', background: '#222', color: 'white', display: 'flex', alignItems: 'center', padding: '0 15px', borderBottom: '1px solid #444', position: 'relative' }}>
          <button onClick={() => setStep(0)} style={{ padding: '8px 12px', background: '#444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', zIndex: 10 }}>Wróć</button>
          <h2 style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', fontSize: '18px', margin: 0, pointerEvents: 'none' }}>Krok 1: Wybierz lokalizację portu</h2>
        </header>
        <div style={{flex: 1}}>
          <Map {...viewState} onMove={evt => setViewState(evt.viewState)} mapStyle={getMapStyle(256) as any} style={{width: '100%', height: '100%'}} dragRotate={false}/>
        </div>
        <footer style={{ height: '80px', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button onClick={() => { resetEditorState(); setEditorMode('mapping'); setStep(2); }} style={{ padding: '15px 40px', fontSize: '18px', cursor: 'pointer', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px' }}>Otwórz Edytor</button>
        </footer>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div style={{ width: '100vw', height: '100vh', background: '#111', color: 'white', display: 'flex', flexDirection: 'column' }}>
        <header style={{ height: '70px', background: '#222', display: 'flex', alignItems: 'center', padding: '0 20px', borderBottom: '1px solid #444' }}>
          <button onClick={() => setStep(2)} style={{ padding: '8px 12px', background: '#444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Wróć</button>
          <h2 style={{ marginLeft: '20px' }}>Konfiguracja parametrów środowiskowych i napędu</h2>
        </header>

        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div style={{ background: '#1e1e1e', padding: '30px', borderRadius: '12px', border: '1px solid #333', width: '450px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>

            <div style={{ marginBottom: '22px' }}>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#bbb', fontSize: '14px' }}>
                🌬️ Kierunek wiatru rzeczywistego: <span style={{ color: '#4CAF50', fontFamily: 'monospace' }}>{windDir}°</span>
              </label>
              <input
                type="range" min="0" max="359" value={windDir}
                onChange={(e) => setWindDir(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666', marginTop: '2px' }}>
                <span>N (0°)</span><span>E (90°)</span><span>S (180°)</span><span>W (270°)</span>
              </div>
            </div>

            <div style={{ marginBottom: '22px' }}>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#bbb', fontSize: '14px' }}>
                💨 Siła wiatru: <span style={{ color: '#4CAF50', fontFamily: 'monospace' }}>{windSpeed} m/s</span>
              </label>
              <input
                type="range" min="0" max="25" step="0.5" value={windSpeed}
                onChange={(e) => setWindSpeed(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer' }}
              />
              <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
                Maksymalnie 25 m/s (Silny sztorm). Generuje automatyczny prąd dryfu wody.
              </div>
            </div>

            <div style={{ marginBottom: '30px' }}>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#bbb', fontSize: '14px' }}>
                ⚙️ Skrętność śruby napędowej:
              </label>
              <select
                value={propHandedness}
                onChange={(e) => setPropHandedness(e.target.value as 'right' | 'left')}
                style={{
                  width: '100%', padding: '10px', background: '#2a2a2a', color: 'white',
                  border: '1px solid #444', borderRadius: '6px', cursor: 'pointer', fontSize: '14px'
                }}
              >
                <option value="right">Prawoskrętna (Prop-walk w lewo przy biegu naprzód)</option>
                <option value="left">Lewoskrętna (Prop-walk w prawo przy biegu naprzód)</option>
              </select>
            </div>

            <button
              onClick={() => setStep(4)}
              style={{
                width: '100%', padding: '15px', fontSize: '18px', background: '#4CAF50',
                border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer',
                fontWeight: 'bold', boxShadow: '0 4px 12px rgba(76, 175, 80, 0.3)',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#45a049')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#4CAF50')}
            >
              Uruchom Symulator ▶
            </button>

          </div>
        </div>
      </div>
    );
  }

  if (step === 4) {
    return (
      <div style={{width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative'}}>
        <header style={{
          height: '70px',
          background: '#111',
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          borderBottom: '1px solid #333',
          zIndex: 100,
          gap: '15px'
        }}>
          <button onClick={() => setStep(3)} style={{ padding: '8px 12px', background: '#444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Wróć</button>
          <button onClick={resetSimulation} style={{ padding: '8px 16px', background: '#dc3545', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>🔄 Resetuj</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fff', fontSize: '13px', cursor: 'pointer', background: '#222', padding: '7px 14px', borderRadius: '4px', border: '1px solid #444', userSelect: 'none' }}>
            <input type="checkbox" checked={showMapBackground} onChange={(e) => setShowMapBackground(e.target.checked)} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
            🗺️ Pokaż mapę satelitarną
          </label>
          <h2 style={{ margin: 0, color: '#fff', fontSize: '18px', marginLeft: 'auto' }}>Ekran Symulacji</h2>
        </header>

        <div style={{flex: 1, position: 'relative', background: showMapBackground ? '#000' : '#1a3a5f'}}>
          {showMapBackground && (
            <div style={{ position: 'absolute', width: '100%', height: '100%', transform: `translate(${stagePos.x}px, ${stagePos.y}px) scale(${stageScale})`, transformOrigin: '0 0', pointerEvents: 'none' }}>
              <Map interactive={false} {...viewState} mapStyle={getMapStyle(tileSize) as any} style={{width: '100%', height: '100%'}} />
            </div>
          )}

          <Stage
            width={dimensions.width}
            height={dimensions.height - 70}
            onMouseDown={(e) => {
              if (e.evt.button === 0) setIsSteeringWithMouse(true);
              else if (e.evt.button === 1) {
                simThrottleRef.current = 0;
                setThrottle(0);
              }
              else if (e.evt.button === 2) setIsPanning(true);
            }}
            onMouseMove={(e) => {
              if (isPanning) {
                setStagePos(prev => ({ x: prev.x + e.evt.movementX, y: prev.y + e.evt.movementY }));
              }
              if (isSteeringWithMouse) {
                const delta = e.evt.movementX * 0.15;
                simRudderRef.current = Math.max(-45, Math.min(45, simRudderRef.current + delta));
                setRudder(Math.round(simRudderRef.current));
              }
            }}
            onMouseUp={() => { setIsPanning(false); setIsSteeringWithMouse(false); }}
            onMouseLeave={() => { setIsPanning(false); setIsSteeringWithMouse(false); }}
            onWheel={(e) => {
              // Zmiana z shiftKey na ctrlKey lub metaKey (Cmd na Macu)
              if (e.evt.ctrlKey || e.evt.metaKey) {
                const stage = e.target.getStage();
                if (!stage) return;
                const oldScale = stageScale;
                const pointer = stage.getPointerPosition();
                if (!pointer) return;
                const mousePointTo = { x: (pointer.x - stagePos.x) / oldScale, y: (pointer.y - stagePos.y) / oldScale };
                const newScale = e.evt.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
                setStageScale(newScale);
                // Naprawiono literówkę z pointer.x na pointer.y przy obliczaniu osi Y
                setStagePos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
              } else {
                const delta = e.evt.deltaY < 0 ? 5 : -5;
                simThrottleRef.current = Math.max(-50, Math.min(100, simThrottleRef.current + delta));
                setThrottle(Math.round(simThrottleRef.current));
              }
            }}
            onContextMenu={(e) => e.evt.preventDefault()}
          >
            <Layer x={stagePos.x} y={stagePos.y} scaleX={stageScale} scaleY={stageScale}>
              {polygons.map((polyPoints, polyIdx) => (
                <Line key={polyIdx} points={polyPoints} fill="rgba(255, 255, 255, 0.15)" stroke="rgba(255, 255, 255, 0.5)" strokeWidth={1 / stageScale} closed={polyPoints.length >= 6} />
              ))}
              {simBoat && (
                <Group x={simBoat.x} y={simBoat.y} rotation={simBoat.rotation}>
                  <Line points={getSimBoatPoints()} fill="rgba(0, 123, 255, 0.75)" stroke="#007bff" strokeWidth={2 / stageScale} closed={true} />
                </Group>
              )}
            </Layer>
          </Stage>

          {/* TELEMETRIA DIAGNOSTYCZNA W REAL-TIME */}
          <div style={{
            position: 'absolute',
            top: '20px',
            left: '20px',
            background: 'rgba(20, 20, 20, 0.9)',
            padding: '15px',
            borderRadius: '6px',
            border: '1px solid #444',
            color: '#eee',
            fontSize: '12px',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <strong style={{color: '#4CAF50', marginBottom: '4px'}}>TELEMETRIA I WARUNKI:</strong>
            <div>🌊 Środowisko: Płytka woda (Port)</div>
            <div>💨 Wiatr: {windSpeedRef.current} m/s z {windDirRef.current}°</div>
            <div>⚙️ Śruba: {propHandednessRef.current === 'right' ? 'Prawoskrętna' : 'Lewoskrętna'}</div>
            <div>⚡ Obroty silnika (RPM): <span style={{color: '#ff9800'}}>{currentRPMRef.current.toFixed(0)}%</span></div>
            <hr style={{border: '0.5px solid #444', margin: '6px 0'}} />
            <div>Prędkość podłużna (u): <span style={{color: '#fff'}}>{simStateRef.current.u.toFixed(2)} m/s</span></div>
            <div>Prędkość poprzeczna (v): <span style={{color: '#fff'}}>{simStateRef.current.v.toFixed(2)} m/s</span></div>
            <div>Yaw Rate (r): <span style={{color: '#fff'}}>{(simStateRef.current.r * (180 / Math.PI)).toFixed(1)} °/s</span></div>
          </div>

          <div style={{
            position: 'absolute',
            bottom: '20px',
            left: '20px',
            background: 'rgba(20, 20, 20, 0.85)',
            padding: '12px 15px',
            borderRadius: '6px',
            border: '1px solid #444',
            color: '#eee',
            fontSize: '12px',
            pointerEvents: 'none'
          }}>
            <strong style={{color: '#2196F3'}}>Sterowanie:</strong>
            <ul style={{margin: '5px 0 0 0', paddingLeft: '18px'}}>
              <li>⌨️ <strong>W / S:</strong> Przepustnica | <strong>A / D:</strong> Koło sterowe</li>
              <li>🖱️ <strong>LPM + Ruch myszą w poziomie:</strong> Płynne wychylenie płetwy</li>
              <li>🔊 <strong>Kółko myszy:</strong> Przepustnica | <strong>Ctrl + Kółko:</strong> Zoom</li>
            </ul>
          </div>

          {/* HUD: PIONOWA MANETKA */}
          <div style={{ position: 'absolute', right: '30px', top: '50%', transform: 'translateY(-50%)', width: '65px', height: '260px', background: 'rgba(25, 25, 25, 0.9)', border: '2px solid #444', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '15px 5px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)', fontFamily: 'monospace', userSelect: 'none' }}>
            <div style={{ fontSize: '10px', color: '#ff4d4d', fontWeight: 'bold' }}>NAPRZÓD</div>
            <div style={{ position: 'relative', width: '4px', height: '150px', background: '#333', borderRadius: '2px' }}>
              <div style={{ position: 'absolute', bottom: '33.33%', left: '-8px', width: '20px', height: '2px', background: '#888' }} />
              <div style={{ position: 'absolute', bottom: `${((throttle + 50) / 150) * 100}%`, left: '-18px', width: '40px', height: '4px', background: throttle === 0 ? '#fff' : throttle > 0 ? '#4CAF50' : '#ff9800', boxShadow: throttle === 0 ? 'none' : throttle > 0 ? '0 0 8px #4CAF50' : '0 0 8px #ff9800' }} />
            </div>
            <div style={{ fontSize: '10px', color: '#4da6ff', fontWeight: 'bold' }}>WSTECZ</div>
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff', background: '#222', padding: '3px 6px', borderRadius: '4px', border: '1px solid #444' }}>{throttle}%</div>
          </div>

          {/* HUD: POZIOMY STER */}
          <div style={{ position: 'absolute', bottom: '25px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(25, 25, 25, 0.9)', border: '2px solid #444', borderRadius: '8px', padding: '12px 25px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', alignItems: 'center', userSelect: 'none' }}>
            <svg width="160" height="85" style={{ overflow: 'visible' }}>
              <path d="M 10 80 A 70 70 0 0 1 150 80" fill="none" stroke="#444" strokeWidth="4" strokeLinecap="round" />
              <path d="M 25 80 A 55 55 0 0 1 135 80" fill="none" stroke="#666" strokeWidth="1" strokeDasharray="3 3" />
              <line x1="80" y1="80" x2="80" y2="10" stroke="#555" strokeWidth="1" strokeDasharray="2 2" />
              <g transform={`rotate(${Math.round(rudder)}, 80, 80)`}>
                <line x1="80" y1="80" x2="80" y2="25" stroke="#4CAF50" strokeWidth="4" strokeLinecap="round" />
                <polygon points="80,12 73,28 87,28" fill="#4CAF50" />
              </g>
              <circle cx="80" cy="80" r="6" fill="#fff" stroke="#222" strokeWidth="2" />
            </svg>
            <div style={{ color: '#fff', fontSize: '13px', fontFamily: 'monospace', fontWeight: 'bold', marginTop: '6px' }}>
              STER: {Math.round(Math.abs(rudder))}° {Math.round(rudder) === 0 ? '0' : Math.round(rudder) > 0 ? 'PRAWA ▶' : '◀ LEWA'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
      <header style={{ height: '70px', background: '#222', color: 'white', position: 'relative', display: 'flex', alignItems: 'center', padding: '0 15px', zIndex: 100, borderBottom: '1px solid #444', gap: '10px' }}>
        <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
          <button onClick={() => setStep(0)} style={{ padding: '8px 12px', background: '#444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Wróć</button>
          <select value={tileSize} onChange={(e) => setTileSize(Number(e.target.value))} style={{ padding: '7px 8px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '4px' }}>
            <option value={256}>Jakość: Standard</option>
            <option value={128}>Jakość: HD</option>
            <option value={64}>Jakość: UHD</option>
            <option value={32}>Jakość: UHD+</option>
          </select>
        </div>
        <div style={{display: 'flex', flex: 1, justifyContent: 'center', gap: '10px', alignItems: 'center'}}>
          {creationStart && <div style={{ background: '#ff9800', color: '#000', padding: '8px 15px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', animation: 'pulse 1.5s infinite' }}>📍 {creationStart.mode === 'boat' ? 'Wskaż dziób łodzi' : 'Wskaż koniec bomu'}</div>}
          <div onMouseEnter={() => setShowControls(true)} onMouseLeave={() => setShowControls(false)} style={{position: 'relative'}}>
            <div style={{ background: '#007bff', color: 'white', padding: '8px 15px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', cursor: 'help' }}>Sterowanie</div>
            {showControls && (
              <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '10px', background: '#333', padding: '15px', borderRadius: '8px', width: '320px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', border: '1px solid #555', zIndex: 100 }}>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '12px', lineHeight: '1.8', color: '#eee' }}>
                  <li>Template Info</li>
                </ul>
              </div>
            )}
          </div>
        </div>
        <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
          <button onClick={handleUndo} disabled={undoStack.length === 0} style={{ padding: '8px 10px', background: '#444', color: undoStack.length > 0 ? '#fff' : '#777', border: 'none', borderRadius: '4px' }}>↩</button>
          <button onClick={handleRedo} disabled={redoStack.length === 0} style={{ padding: '8px 10px', background: '#444', color: redoStack.length > 0 ? '#fff' : '#777', border: 'none', borderRadius: '4px' }}>↪</button>
          {editorMode === 'mapping' ? (
            <button onClick={handleSave} style={{ background: '#4CAF50', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Zapisz</button>
          ) : (
            <button onClick={() => setStep(3)} style={{ background: '#2196F3', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Kontynuuj</button>
          )}
        </div>
      </header>
      <div style={{flex: 1, position: 'relative', background: '#000'}}>
        <div style={{ position: 'absolute', width: '100%', height: '100%', transform: `translate(${stagePos.x}px, ${stagePos.y}px) scale(${stageScale})`, transformOrigin: '0 0', pointerEvents: 'none' }}>
          <Map interactive={false} {...viewState} mapStyle={getMapStyle(tileSize) as any} style={{width: '100%', height: '100%'}} />
        </div>
        <Stage
          width={dimensions.width} height={dimensions.height - 70} onMouseDown={handleStageMouseDown}
          onMouseMove={(e) => isPanning && setStagePos(prev => ({ x: prev.x + e.evt.movementX, y: prev.y + e.evt.movementY }))}
          onMouseUp={() => setIsPanning(false)}
          onWheel={(e) => {
            const stage = e.target.getStage();
            const oldScale = stageScale;
            const pointer = stage!.getPointerPosition();
            if (!pointer) return;
            const mousePointTo = {x: (pointer.x - stagePos.x) / oldScale, y: (pointer.y - stagePos.y) / oldScale};
            const newScale = e.evt.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
            setStageScale(newScale);
            setStagePos({x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale});
          }}
          onContextMenu={(e) => e.evt.preventDefault()}
        >
          <Layer x={stagePos.x} y={stagePos.y} scaleX={stageScale} scaleY={stageScale}>
            {polygons.map((polyPoints, polyIdx) => (
              <Group key={polyIdx}>
                <Line
                  points={polyPoints} fill={polyIdx === activePolyIdx ? "rgba(0, 255, 0, 0.25)" : "rgba(255, 255, 255, 0.1)"}
                  stroke={polyIdx === activePolyIdx ? "#00ff00" : "#ffffff"} strokeWidth={(polyIdx === activePolyIdx ? 2 : 1) / stageScale}
                  closed={polyPoints.length >= 6} onMouseDown={(e) => { if (e.evt.button === 1) { setActivePolyIdx(polyIdx); e.cancelBubble = true; } }}
                />
                {polyIdx === activePolyIdx && Array.from({length: polyPoints.length / 2}).map((_, i) => (
                  <Circle
                    key={i} x={polyPoints[i * 2]} y={polyPoints[i * 2 + 1]} radius={5 / stageScale} fill="white" stroke="#00ff00" strokeWidth={1 / stageScale} draggable onDragStart={saveHistory}
                    onDragMove={(e) => { const next = [...polygons]; next[polyIdx][i * 2] = e.target.x(); next[polyIdx][i * 2 + 1] = e.target.y(); setPolygons(next); }}
                    onContextMenu={(e) => { e.evt.preventDefault(); saveHistory(); const next = [...polygons]; const upd = [...next[polyIdx]]; upd.splice(i * 2, 2); next[polyIdx] = upd; setPolygons(next); }}
                  />
                ))}
              </Group>
            ))}
            {startPoint && (
              <Group
                x={startPoint.x} y={startPoint.y} rotation={startPoint.rotation}
                onWheel={(e) => { e.cancelBubble = true; saveHistory(); setStartPoint(prev => prev ? { ...prev, rotation: prev.rotation + (e.evt.deltaY > 0 ? 15 : -15) } : null); }}
                draggable onDragStart={saveHistory} onDragMove={(e) => setStartPoint(prev => prev ? {...prev, x: e.target.x(), y: e.target.y()} : null)}
              >
                <Arrow points={[0, 0, 30 / stageScale, 0]} pointerLength={10 / stageScale} pointerWidth={10 / stageScale} fill="#4CAF50" stroke="#4CAF50" strokeWidth={3 / stageScale}/>
                <Circle radius={6 / stageScale} fill="white" stroke="#4CAF50" strokeWidth={2 / stageScale}/>
              </Group>
            )}
          </Layer>
        </Stage>
      </div>
      <style>{` @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.6; } 100% { opacity: 1; } } `}</style>
    </div>
  );
}

export default App;
