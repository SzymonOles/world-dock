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
const BOAT_WIDTH = 1.85;    // Szerokość łodzi
const BOW_NARROW_DIST = 1.0; // Odległość od dziobu, gdzie zaczyna się zwężenie
const BOAT_LEN = 5.5

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

function App() {
  // 0 = home
  // 1 = wybór lokalizacji
  // 2 = editor mapping
  // 3 = konfiguracja symulacji
  // 4 = ekran symulacji
  type Step = 0 | 1 | 2 | 3 | 4;
  const [step, setStep] = useState<Step>(0);  const [viewState, setViewState] = useState({longitude: 18.66, latitude: 54.40, zoom: 8});

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

  // Stan dla tworzenia obiektów (bom / łódź)
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


  const handleSave = async () => {
    if (!startPoint) {
      alert("Dodaj punkt startowy przed zapisem!");
      return;
    }

    // Przygotowanie paczki danych zgodnie z Twoimi wymaganiami
    const payload = {
      location: {
        lng: viewState.longitude,
        lat: viewState.latitude
      },
      zoom: viewState.zoom,
      quality: tileSize,
      startPoint: startPoint, // Zawiera x, y, rotation
      polygons: polygons.filter(poly => poly.length >= 6) // Zapisujemy tylko poprawne kształty
    };

    try {
      // Wywołanie wystawionej w preload/index.ts funkcji savePortData
      const response = await window.api.savePortData(payload);

      // Zakładając, że Twój handler w main/index.ts zwraca obiekt z sukcesem
      if (response && (response as any).success) {
        alert("Pomyślnie zapisano projekt w bazie!");
        setStep(0);
      } else {
        alert("Błąd zapisuj: " + ((response as any).message || "Nieznany błąd"));
      }
    } catch (error) {
      console.error("Błąd podczas komunikacji z bazą:", error);
      alert("Wystąpił błąd krytyczny podczas zapisu.");
    }
  };

  // Funkcja pobierająca porty na podstawie tego, co wвидно na mapie
  const fetchVisiblePorts = async (view: any) => {
    // Obliczamy granice mapy (uproszczone)
    // MapLibre w evencie onMove udostępnia viewState, ale granice (bounds) najlepiej brać z mapy
    // Tutaj dla uproszczenia pobierzemy porty w promieniu +/- 2 stopnie od środka
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

      // viewport
      setViewState({
        longitude: port.center_lng,
        latitude: port.center_lat,
        zoom: port.zoom_level
      });

      // jakość tiles
      setTileSize(port.tile_quality);

      // punkt startowy
      setStartPoint(port.start_point_json);

      // poligony
      const loadedPolygons = (shapes ?? []).map((s: any) => s.raw_points);
      setPolygons(
        loadedPolygons.length > 0
          ? loadedPolygons
          : [[]]
      );

      setActivePolyIdx(0);

      // reset historii
      setUndoStack([]);
      setRedoStack([]);

      // reset zoom/pan stage
      setStageScale(1);
      setStagePos({ x: 0, y: 0 });

      // tryb symulacji
      setEditorMode('simulation');

      setPendingStep(2);
      setWaitingForMap(true);

    } catch (err) {
      console.error(err);
      alert('Błąd ładowania portu');
    }
  };

  // Inicjalne pobranie
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

  // --- STANY I REFY DLA EKRANU SYMULACJI (STEP 4) ---
  const [simBoat, setSimBoat] = useState<{ x: number; y: number; rotation: number } | null>(null);
  const [throttle, setThrottle] = useState<number>(0); // Zakres: -50% do 100%
  const [rudder, setRudder] = useState<number>(0);     // Zakres: -45° do 45°
  const [isSteeringWithMouse, setIsSteeringWithMouse] = useState(false);
  const [showMapBackground, setShowMapBackground] = useState<boolean>(true); // Przełącznik podkładu mapowego

  // Refy zapewniające płynny dostęp do stanów w pętli animacji bez jej restartowania
  const throttleRef = useRef(0);
  const rudderRef = useRef(0);
  const keysPressed = useRef<Set<string>>(new Set());

  // Synchronizacja zmiennych ref ze stanem Reacta (dla myszy i UI)
  useEffect(() => { throttleRef.current = throttle; }, [throttle]);
  useEffect(() => { rudderRef.current = rudder; }, [rudder]);

  // Reset symulacji do punktu początkowego
  const resetSimulation = useCallback(() => {
    if (startPoint) {
      setSimBoat({
        x: startPoint.x,
        y: startPoint.y,
        rotation: startPoint.rotation
      });
    }
    setThrottle(0);
    setRudder(0);
  }, [startPoint]);

  // Inicjalizacja pozycji przy wejściu do kroku 4
  useEffect(() => {
    if (step === 4) {
      resetSimulation();
    }
  }, [step, resetSimulation]);

  // Słuchacz klawiatury wspierający jednoczesne wciskanie wielu klawiszy (kombinacje W+A itp.)
  useEffect(() => {
    if (step !== 4) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.current.add(e.key.toLowerCase());
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.key.toLowerCase());
    };

    // Zablokowanie domyślnego zachowania scrolla okna przeglądarki
    const handleWindowWheel = (e: WheelEvent) => {
      e.preventDefault();
    };

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

  // Algorytm Ray-Casting (punkt w wielokącie) do wykrywania kolizji
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

  // Generator punktów kształtu łodzi symulacyjnej
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

  // Naprawiona pętla fizyki i detekcji kolizji czasu rzeczywistego
  useEffect(() => {
    // Zabezpieczenie: pętla startuje ZAWSZE gdy jesteśmy w kroku 4,
    // nie czekając na asynchroniczne ustawienie stanu simBoat
    if (step !== 4) return;

    let animId: number;

    const updatePhysics = () => {
      // 1. Przetwarzanie wejścia klawiatury (Wsparcie dla wciśniętych kombinacji klawiszy jednocześnie)
      let currentThrottle = throttleRef.current;
      let currentRudder = rudderRef.current;

      let keysChanged = false;
      if (keysPressed.current.has('w')) {
        currentThrottle = Math.min(100, currentThrottle + 1.2);
        keysChanged = true;
      }
      if (keysPressed.current.has('s')) {
        currentThrottle = Math.max(-50, currentThrottle - 1.2);
        keysChanged = true;
      }
      if (keysChanged) {
        setThrottle(Math.round(currentThrottle));
      }

      let rudderChanged = false;
      if (keysPressed.current.has('a') || keysPressed.current.has('arrowleft')) {
        currentRudder = Math.max(-45, currentRudder - 1.5);
        rudderChanged = true;
      }
      if (keysPressed.current.has('d') || keysPressed.current.has('arrowright')) {
        currentRudder = Math.min(45, currentRudder + 1.5);
        rudderChanged = true;
      }
      if (rudderChanged) {
        setRudder(currentRudder);
      }

      // 2. Kalkulacja przemieszczenia i obrotu statku
      setSimBoat(prev => {
        // POPRAWKA: Jeśli stan łodzi jeszcze się nie załadował z resetSimulation(),
        // po prostu pomijamy tę klatkę i czekamy na kolejną, ale NIE ubijamy pętli!
        if (!prev) return null;

        const mpp = getMetersPerPixel();
        const speedMetersPerSecond = (currentThrottle / 100) * 5.0;
        const currentSpeedPixels = (speedMetersPerSecond * 0.016) / mpp;

        const rotationSpeedPerFrame = (currentRudder / 45) * 30 * 0.016 * (currentThrottle / 100);
        const nextRotation = prev.rotation + rotationSpeedPerFrame;

        const rad = (nextRotation * Math.PI) / 180;
        const nextX = prev.x + Math.cos(rad) * currentSpeedPixels;
        const nextY = prev.y + Math.sin(rad) * currentSpeedPixels;

        // Sprawdzenie punktów kadłuba pod kątem kolizji z poligonami mapy
        const localPts = getSimBoatPoints();
        const cosR = Math.cos(rad);
        const sinR = Math.sin(rad);
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
          return { ...prev, rotation: nextRotation };
        }

        return { x: nextX, y: nextY, rotation: nextRotation };
      });

      // Kontynuowanie pętli w następnej klatce animacji
      animId = requestAnimationFrame(updatePhysics);
    };

    animId = requestAnimationFrame(updatePhysics);
    return () => cancelAnimationFrame(animId);
  }, [step, polygons, getMetersPerPixel]);

  // Generator kształtu bomów
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

  // Generator kształtu łodzi
  const generateBoatPoints = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
    const mpp = getMetersPerPixel();
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const angle = Math.atan2(dy, dx);
    const length = Math.hypot(dx, dy);

    const bW = (BOAT_WIDTH / 2) / mpp;
    const narrowStart = Math.max(0, length - (BOW_NARROW_DIST / mpp));
    // Punkt pośredni dla wygładzenia (w połowie drogi zwężenia)
    const smoothX = narrowStart + (length - narrowStart) * 0.5;
    const smoothW = bW * 0.7; // Węższy niż podstawa, szerszy niż dziób

    const rot = (x, y) => [
      p1.x + (x * Math.cos(angle) - y * Math.sin(angle)),
      p1.y + (x * Math.sin(angle) + y * Math.cos(angle))
    ];

    // Punkty: Tył Lewo -> Zwężenie Lewo -> Dziób -> Zwężenie Prawo -> Tył Prawo
    return [
      ...rot(0, -bW),           // Tył Lewo
      ...rot(narrowStart, -bW), // Początek zwężenia Lewo
      ...rot(smoothX, -smoothW),// Wygładzenie Lewo
      ...rot(length, 0),        // Dziób
      ...rot(smoothX, smoothW), // Wygładzenie Prawo
      ...rot(narrowStart, bW),  // Początek zwężenia Prawo
      ...rot(0, bW)             // Tył Prawo
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

      // Inicjalizacja tworzenia
      if (isShiftAlt || isCtrlAlt || isShiftCtrl) {
        setCreationStart({
          x, y,
          mode: isShiftCtrl ? 'boat' : (isShiftAlt ? 'deck' : 'no-deck')
        });
        return;
      }

      // Finalizacja tworzenia (drugi klik)
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

      // Standardowe funkcje (Ctrl + LPM = Start Point)
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

  // --- WIDOK 0: STRONA GŁÓWNA ---
  if (step === 0) {
    return (
      <div style={{width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column'}}>
        <header style={{
          height: '60px',
          background: '#1a1a1a',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <h2>Moje Porty</h2>
        </header>

        <div style={{flex: 1, position: 'relative'}}>
          <Map
            {...viewState}
            onMove={evt => {
              setViewState(evt.viewState);
              fetchVisiblePorts(evt.viewState);
            }}
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
              <Marker
                key={port.id}
                longitude={port.center_lng}
                latitude={port.center_lat}
                onClick={e => {
                  e.originalEvent.stopPropagation();
                  setSelectedPort(port);
                }}
              >
                <div style={{cursor: 'pointer', fontSize: '24px'}}>🚩</div>
              </Marker>
            ))}

            {selectedPort && (
              <Popup
                longitude={selectedPort.center_lng}
                latitude={selectedPort.center_lat}
                anchor="bottom"
                onClose={() => setSelectedPort(null)}
              >
                <div style={{padding: '5px', textAlign: 'center'}}>
                  <button
                    onClick={() => loadPortForSimulation(selectedPort.id)}
                    style={{
                      background: '#007bff',
                      color: 'white',
                      border: 'none',
                      padding: '5px 10px',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Przygotuj symulację
                  </button>
                </div>
              </Popup>
            )}
          </Map>
        </div>

        <footer style={{
          height: '80px',
          background: '#1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <button
            onClick={() => setStep(1)}
            style={{
              padding: '15px 40px',
              fontSize: '18px',
              cursor: 'pointer',
              background: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              fontWeight: 'bold'
            }}
          >
            Mapuj nowy port
          </button>
        </footer>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div style={{width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column'}}>
        <header style={{
          height: '70px',
          background: '#222',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          padding: '0 15px',
          borderBottom: '1px solid #444',
          position: 'relative'
        }}>
          <button
            onClick={() => setStep(0)}
            style={{
              padding: '8px 12px',
              background: '#444',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              zIndex: 10
            }}
          >
            Wróć
          </button>
          <h2 style={{
            position: 'absolute',
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: '18px',
            margin: 0,
            pointerEvents: 'none'
          }}>
            Krok 1: Wybierz lokalizację portu
          </h2>
        </header>
        <div style={{flex: 1}}>
          <Map {...viewState} onMove={evt => setViewState(evt.viewState)} mapStyle={getMapStyle(256) as any}
               style={{width: '100%', height: '100%'}} dragRotate={false}/>
        </div>
        <footer style={{
          height: '80px',
          background: '#1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <button onClick={() => {
            resetEditorState();
            setEditorMode('mapping');
            setStep(2);
          }} style={{
            padding: '15px 40px',
            fontSize: '18px',
            cursor: 'pointer',
            background: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '5px'
          }}>Otwórz Edytor
          </button>
        </footer>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          background: '#111',
          color: 'white',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <header
          style={{
            height: '70px',
            background: '#222',
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            borderBottom: '1px solid #444'
          }}
        >
          <button
            onClick={() => setStep(2)}
            style={{
              padding: '8px 12px',
              background: '#444',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Wróć
          </button>

          <h2 style={{ marginLeft: '20px' }}>
            Konfiguracja symulacji
          </h2>
        </header>

        <div
          style={{
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}
        >
          <div>
            Jakieś ustawienia...
          </div>
          <button
            onClick={() => setStep(4)}
            style={{
              padding: '20px 40px',
              fontSize: '22px',
              background: '#4CAF50',
              border: 'none',
              borderRadius: '8px',
              color: 'white',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            Rozpocznij symulację
          </button>
        </div>
      </div>
    );
  }

  if (step === 4) {
    return (
      <div style={{width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative'}}>
        {/* NAGŁÓWEK SYMULACJI Z PRZYCISKAMI */}
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
          <button
            onClick={() => setStep(3)}
            style={{
              padding: '8px 12px',
              background: '#444',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Wróć
          </button>

          <button
            onClick={resetSimulation}
            style={{
              padding: '8px 16px',
              background: '#dc3545',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#bd2130')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#dc3545')}
          >
            🔄 Resetuj symulację
          </button>

          {/* NOWOŚĆ: PRZEŁĄCZNIK PODKŁADU MAPY */}
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: '#fff',
            fontSize: '13px',
            cursor: 'pointer',
            background: '#222',
            padding: '7px 14px',
            borderRadius: '4px',
            border: '1px solid #444',
            userSelect: 'none',
            fontWeight: '500'
          }}>
            <input
              type="checkbox"
              checked={showMapBackground}
              onChange={(e) => setShowMapBackground(e.target.checked)}
              style={{ cursor: 'pointer', width: '15px', height: '15px' }}
            />
            🗺️ Pokaż mapę satelitarną
          </label>

          <h2 style={{ margin: 0, color: '#fff', fontSize: '18px', marginLeft: 'auto' }}>Ekran Symulacji</h2>
        </header>

        {/* KONTENER SYMULACJI - Dynamiczne tło: czarne dla mapy, morskie niebieskie gdy mapa wyłączona */}
        <div style={{flex: 1, position: 'relative', background: showMapBackground ? '#000' : '#1a3a5f'}}>
          {/* WARUNKOWE RENDEROWANIE MAPY JAKO NIERUCHOMEGO TŁA */}
          {showMapBackground && (
            <div style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              transform: `translate(${stagePos.x}px, ${stagePos.y}px) scale(${stageScale})`,
              transformOrigin: '0 0',
              pointerEvents: 'none'
            }}>
              <Map
                interactive={false}
                {...viewState}
                mapStyle={getMapStyle(tileSize) as any}
                style={{width: '100%', height: '100%'}}
              />
            </div>
          )}

          {/* WARSTWA INTERAKTYWNA KONVA */}
          <Stage
            width={dimensions.width}
            height={dimensions.height - 70}
            onMouseDown={(e) => {
              if (e.evt.button === 0) {
                // LPM rozpoczyna płynne sterowanie myszą lewo/prawo
                setIsSteeringWithMouse(true);
              } else if (e.evt.button === 1) {
                // Kliknięcie kółka myszy (ŚPM) resetuje manetkę do zera
                setThrottle(0);
              } else if (e.evt.button === 2) {
                // Prawy przycisk myszy włącza panowanie widoku kamery
                setIsPanning(true);
              }
            }}
            onMouseMove={(e) => {
              // Panowanie widoku za pomocą PPM
              if (isPanning) {
                setStagePos(prev => ({
                  x: prev.x + e.evt.movementX,
                  y: prev.y + e.evt.movementY
                }));
              }
              // Sterowanie płynne za pomocą LPM (Zmniejszona czułość: 0.15)
              if (isSteeringWithMouse) {
                setRudder(prev => {
                  const nextRudder = prev + e.evt.movementX * 0.15;
                  return Math.max(-45, Math.min(45, nextRudder));
                });
              }
            }}
            onMouseUp={() => {
              setIsPanning(false);
              setIsSteeringWithMouse(false);
            }}
            onMouseLeave={() => {
              setIsPanning(false);
              setIsSteeringWithMouse(false);
            }}
            onWheel={(e) => {
              // NOWOŚĆ: Skrót Shift + Scroll kontroluje przybliżenie i oddalenie mapy
              if (e.evt.shiftKey) {
                const stage = e.target.getStage();
                if (!stage) return;
                const oldScale = stageScale;
                const pointer = stage.getPointerPosition();
                if (!pointer) return;

                const mousePointTo = {
                  x: (pointer.x - stagePos.x) / oldScale,
                  y: (pointer.y - stagePos.y) / oldScale
                };
                const newScale = e.evt.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
                setStageScale(newScale);
                setStagePos({
                  x: pointer.x - mousePointTo.x * newScale,
                  y: pointer.y - mousePointTo.y * newScale
                });
              } else {
                // Sam Scroll kontroluje manetkę gazu
                setThrottle(prev => {
                  const delta = e.evt.deltaY < 0 ? 5 : -5;
                  return Math.max(-50, Math.min(100, prev + delta));
                });
              }
            }}
            onContextMenu={(e) => e.evt.preventDefault()}
          >
            <Layer x={stagePos.x} y={stagePos.y} scaleX={stageScale} scaleY={stageScale}>
              {/* Wyświetlanie zablokowanych poligonów */}
              {polygons.map((polyPoints, polyIdx) => (
                <Line
                  key={polyIdx}
                  points={polyPoints}
                  fill="rgba(255, 255, 255, 0.15)"
                  stroke="rgba(255, 255, 255, 0.5)"
                  strokeWidth={1 / stageScale}
                  closed={polyPoints.length >= 6}
                />
              ))}

              {/* Renderowanie kontrolowanego statku */}
              {simBoat && (
                <Group x={simBoat.x} y={simBoat.y} rotation={simBoat.rotation}>
                  <Line
                    points={getSimBoatPoints()}
                    fill="rgba(0, 123, 255, 0.75)"
                    stroke="#007bff"
                    strokeWidth={2 / stageScale}
                    closed={true}
                  />
                </Group>
              )}
            </Layer>
          </Stage>

          {/* UAKTUALNIONA LEGENDA INTERFEJSU */}
          <div style={{
            position: 'absolute',
            top: '20px',
            left: '20px',
            background: 'rgba(20, 20, 20, 0.85)',
            padding: '12px 15px',
            borderRadius: '6px',
            border: '1px solid #444',
            color: '#eee',
            fontSize: '12px',
            lineHeight: '1.6',
            pointerEvents: 'none'
          }}>
            <strong style={{color: '#4CAF50'}}>Sterowanie symulacją:</strong>
            <ul style={{margin: '5px 0 0 0', paddingLeft: '18px'}}>
              <li>⌨️ <strong>Klawisze W / S lub Kółko:</strong> Sterowanie manetką </li>
              <li>🖱️ <strong>Kliknięcie kółka (ŚPM):</strong> Szybkie zerowanie manetki (Luz)</li>
              <li>🖱️ <strong>Klawisze Shift + Kółko myszy:</strong> Przybliżanie / Oddalanie widoku</li>
              <li>🖱️ <strong>Trzymanie PPM + Ruch myszą:</strong> Przesuwanie widoku kamery</li>
              <li>🖱️ <strong>Trzymanie LPM + Ruch myszą (L/P):</strong> Płynne sterowanie kołem sterowym (Czułe)</li>
              <li>⌨️ <strong>Klawisze A / D lub Strzałki:</strong> Alternatywne skręcanie sterem</li>
            </ul>
          </div>

          {/* HUD: PIONOWA MANETKA */}
          <div style={{
            position: 'absolute',
            right: '30px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '65px',
            height: '260px',
            background: 'rgba(25, 25, 25, 0.9)',
            border: '2px solid #444',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '15px 5px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            fontFamily: 'monospace',
            userSelect: 'none'
          }}>
            <div style={{ fontSize: '10px', color: '#ff4d4d', fontWeight: 'bold' }}>NAPRZÓD</div>
            <div style={{ position: 'relative', width: '4px', height: '150px', background: '#333', borderRadius: '2px' }}>
              <div style={{ position: 'absolute', bottom: '33.33%', left: '-8px', width: '20px', height: '2px', background: '#888' }} />
              <div style={{
                position: 'absolute',
                bottom: `${((throttle + 50) / 150) * 100}%`,
                left: '-18px',
                width: '40px',
                height: '4px',
                background: throttle === 0 ? '#fff' : throttle > 0 ? '#4CAF50' : '#ff9800',
                boxShadow: throttle === 0 ? 'none' : throttle > 0 ? '0 0 8px #4CAF50' : '0 0 8px #4CAF50',
              }} />
            </div>
            <div style={{ fontSize: '10px', color: '#4da6ff', fontWeight: 'bold' }}>WSTECZ</div>
            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff', background: '#222', padding: '3px 6px', borderRadius: '4px', border: '1px solid #444' }}>
              {throttle}%
            </div>
          </div>

          {/* HUD: POZIOMY STER */}
          <div style={{
            position: 'absolute',
            bottom: '25px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(25, 25, 25, 0.9)',
            border: '2px solid #444',
            borderRadius: '8px',
            padding: '12px 25px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            userSelect: 'none'
          }}>
            <svg width="160" height="85" style={{ overflow: 'visible' }}>
              <path d="M 10 80 A 70 70 0 0 1 150 80" fill="none" stroke="#444" strokeWidth="4" strokeLinecap="round" />
              <path d="M 25 80 A 55 55 0 0 1 135 80" fill="none" stroke="#666" strokeWidth="1" strokeDasharray="3 3" />
              <line x1="80" y1="80" x2="80" y2="10" stroke="#555" strokeWidth="1" strokeDasharray="2 2" />

              {/* ZAOKRĄGLANIE STOPNI NA GRAFICE UI */}
              <g transform={`rotate(${Math.round(rudder)}, 80, 80)`}>
                <line x1="80" y1="80" x2="80" y2="25" stroke="#4CAF50" strokeWidth="4" strokeLinecap="round" />
                <polygon points="80,12 73,28 87,28" fill="#4CAF50" />
              </g>
              <circle cx="80" cy="80" r="6" fill="#fff" stroke="#222" strokeWidth="2" />
            </svg>
            {/* ZAOKRĄGLANIE STOPNI NA WYŚWIETLACZU TEKSTOWYM HUD */}
            <div style={{ color: '#fff', fontSize: '13px', fontFamily: 'monospace', fontWeight: 'bold', marginTop: '6px' }}>
              STER: {Math.round(Math.abs(rudder))}° {Math.round(rudder) === 0 ? '0' : Math.round(rudder) > 0 ? 'PRAWA ▶' : '◀ LEWA'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // step === 2
  return (
    <div style={{width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
      <header style={{
        height: '70px',
        background: '#222',
        color: 'white',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        padding: '0 15px',
        zIndex: 100,
        borderBottom: '1px solid #444',
        gap: '10px'
      }}>
        <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
          <button onClick={() => setStep(0)} style={{
            padding: '8px 12px',
            background: '#444',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}>Wróć
          </button>
          <select value={tileSize} onChange={(e) => setTileSize(Number(e.target.value))} style={{
            padding: '7px 8px',
            background: '#333',
            color: 'white',
            border: '1px solid #555',
            borderRadius: '4px'
          }}>
            <option value={256}>Jakość: Standard</option>
            <option value={128}>Jakość: HD</option>
            <option value={64}>Jakość: UHD</option>
            <option value={32}>Jakość: UHD+</option>
          </select>
        </div>

        <div style={{display: 'flex', flex: 1, justifyContent: 'center', gap: '10px', alignItems: 'center'}}>
          {creationStart && (
            <div style={{
              background: '#ff9800',
              color: '#000',
              padding: '8px 15px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 'bold',
              animation: 'pulse 1.5s infinite'
            }}>
              📍 {creationStart.mode === 'boat' ? 'Wskaż dziób łodzi' : 'Wskaż koniec bomu'}
            </div>
          )}
          <div onMouseEnter={() => setShowControls(true)} onMouseLeave={() => setShowControls(false)}
               style={{position: 'relative'}}>
            <div style={{
              background: '#007bff',
              color: 'white',
              padding: '8px 15px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 'bold',
              cursor: 'help'
            }}>Sterowanie
            </div>
            {showControls && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                marginTop: '10px',
                background: '#333',
                padding: '15px',
                borderRadius: '8px',
                width: '320px',
                boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                border: '1px solid #555',
                zIndex: 100
              }}>
                <ul style={{
                  margin: 0,
                  padding: 0,
                  listStyle: 'none',
                  fontSize: '12px',
                  lineHeight: '1.8',
                  color: '#eee'
                }}>
                  <li>🖱️ <strong>PPM:</strong> Przesuwanie mapy</li>
                  <li>🖱️ <strong>LPM:</strong> Dodaj kolejny punkt</li>
                  <li>🖱️ <strong>LPM blisko linii:</strong> Wstaw punkt na linii</li>
                  <li>🖱️ <strong>PPM na punkcie:</strong> Usuwanie punktu</li>
                  <li>⌨️ <strong>Shift + LPM:</strong> Nowy kształt</li>
                  <li>🖱️ <strong>Środkowy Przycisk:</strong> Wybierz kształt</li>
                  <li>⌨️ <strong>Ctrl + Z / Y:</strong> Cofnij / Ponów</li>
                  <li>🖱️ <strong>Ctrl + LPM:</strong> Punkt Startowy 🚩</li>
                  <li>🖱️ <strong>Kółko myszy na punkcie startowym:</strong> Obrót punktu startowego</li>
                  <li>⌨️ <strong>Shift + Ctrl + LPM:</strong> Dodaj Łódź</li>
                  <li>⌨️ <strong>Shift + Alt + LPM:</strong> Bom z pokładem</li>
                  <li>⌨️ <strong>Ctrl + Alt + LPM:</strong> Bom bez pokładu</li>
                  <hr style={{border: '0.5px solid #555', margin: '8px 0'}}/>
                  <li>💡 <em>Łódź rysujemy od tyłu do dziobu.</em></li>
                </ul>
              </div>
            )}
          </div>
        </div>

        <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
          <button onClick={handleUndo} disabled={undoStack.length === 0} style={{
            padding: '8px 10px',
            background: '#444',
            color: undoStack.length > 0 ? '#fff' : '#777',
            border: 'none',
            borderRadius: '4px'
          }}>↩
          </button>
          <button onClick={handleRedo} disabled={redoStack.length === 0} style={{
            padding: '8px 10px',
            background: '#444',
            color: redoStack.length > 0 ? '#fff' : '#777',
            border: 'none',
            borderRadius: '4px'
          }}>↪
          </button>
          {editorMode === 'mapping' ? (
            <button
              onClick={handleSave}
              style={{
                background: '#4CAF50',
                color: 'white',
                border: 'none',
                padding: '8px 20px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              Zapisz
            </button>
          ) : (
            <button
              onClick={() => setStep(3)}
              style={{
                background: '#2196F3',
                color: 'white',
                border: 'none',
                padding: '8px 20px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              Kontynuuj
            </button>
          )}
        </div>
      </header>

      <div style={{flex: 1, position: 'relative', background: '#000'}}>
        <div style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          transform: `translate(${stagePos.x}px, ${stagePos.y}px) scale(${stageScale})`,
          transformOrigin: '0 0',
          pointerEvents: 'none'
        }}>
          <Map
            interactive={false}
            {...viewState}
            mapStyle={getMapStyle(tileSize) as any}
            style={{width: '100%', height: '100%'}}
          />
        </div>
        <Stage
          width={dimensions.width}
          height={dimensions.height - 70}
          onMouseDown={handleStageMouseDown}
          onMouseMove={(e) => isPanning && setStagePos(prev => ({
            x: prev.x + e.evt.movementX,
            y: prev.y + e.evt.movementY
          }))}
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
                  points={polyPoints}
                  fill={polyIdx === activePolyIdx ? "rgba(0, 255, 0, 0.25)" : "rgba(255, 255, 255, 0.1)"}
                  stroke={polyIdx === activePolyIdx ? "#00ff00" : "#ffffff"}
                  strokeWidth={(polyIdx === activePolyIdx ? 2 : 1) / stageScale}
                  closed={polyPoints.length >= 6}
                  onMouseDown={(e) => {
                    if (e.evt.button === 1) {
                      setActivePolyIdx(polyIdx);
                      e.cancelBubble = true;
                    }
                  }}
                />
                {polyIdx === activePolyIdx && Array.from({length: polyPoints.length / 2}).map((_, i) => (
                  <Circle
                    key={i} x={polyPoints[i * 2]} y={polyPoints[i * 2 + 1]}
                    radius={5 / stageScale} fill="white" stroke="#00ff00" strokeWidth={1 / stageScale}
                    draggable onDragStart={saveHistory}
                    onDragMove={(e) => {
                      const next = [...polygons];
                      next[polyIdx][i * 2] = e.target.x();
                      next[polyIdx][i * 2 + 1] = e.target.y();
                      setPolygons(next);
                    }}
                    onContextMenu={(e) => {
                      e.evt.preventDefault();
                      saveHistory();
                      const next = [...polygons];
                      const upd = [...next[polyIdx]];
                      upd.splice(i * 2, 2);
                      next[polyIdx] = upd;
                      setPolygons(next);
                    }}
                  />
                ))}
              </Group>
            ))}
            {startPoint && (
              <Group
                x={startPoint.x} y={startPoint.y} rotation={startPoint.rotation}
                onWheel={(e) => {
                  e.cancelBubble = true;
                  saveHistory();
                  setStartPoint(prev => prev ? {
                    ...prev,
                    rotation: prev.rotation + (e.evt.deltaY > 0 ? 15 : -15)
                  } : null);
                }}
                draggable onDragStart={saveHistory}
                onDragMove={(e) => setStartPoint(prev => prev ? {...prev, x: e.target.x(), y: e.target.y()} : null)}
              >
                <Arrow points={[0, 0, 30 / stageScale, 0]} pointerLength={10 / stageScale}
                       pointerWidth={10 / stageScale} fill="#4CAF50" stroke="#4CAF50" strokeWidth={3 / stageScale}/>
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
