import { useState, useEffect, useCallback } from 'react';
import Map from 'react-map-gl/maplibre';
import { Stage, Layer, Line, Circle, Group, Arrow } from 'react-konva';
import 'maplibre-gl/dist/maplibre-gl.css';
import Konva from 'konva';

declare global {
  interface Window {
    api: {
      savePortData: (payload: any) => Promise<{ message: string }>;
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
  layers: [{ id: 'esri-satellite-layer', type: 'raster', source: 'esri-satellite', minzoom: 0, maxzoom: 20 }]
});

interface EditorState {
  polygons: number[][];
  startPoint: { x: number, y: number, rotation: number } | null;
  activePolyIdx: number;
}

function App() {
  const [step, setStep] = useState<1 | 2>(1);
  const [viewState, setViewState] = useState({ longitude: 18.66, latitude: 54.40, zoom: 7 });
  const [tileSize, setTileSize] = useState<number>(256);

  const [polygons, setPolygons] = useState<number[][]>([[]]);
  const [activePolyIdx, setActivePolyIdx] = useState<number>(0);
  const [startPoint, setStartPoint] = useState<EditorState['startPoint']>(null);

  const [undoStack, setUndoStack] = useState<EditorState[]>([]);
  const [redoStack, setRedoStack] = useState<EditorState[]>([]);

  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const getCurrentState = useCallback((): EditorState => ({
    polygons: JSON.parse(JSON.stringify(polygons)),
    startPoint: startPoint ? { ...startPoint } : null,
    activePolyIdx
  }), [polygons, startPoint, activePolyIdx]);

  const saveHistory = useCallback(() => {
    setUndoStack(prev => [...prev, getCurrentState()]);
    setRedoStack([]);
  }, [getCurrentState]);

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
      if (nativeEvent.ctrlKey) {
        saveHistory();
        setStartPoint({ x, y, rotation: 0 });
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
      let minIndex = -1; let minDistance = Infinity;
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
          if (dist < minDistance) { minDistance = dist; minIndex = i + 2; }
        }
      }
      const HIT_DISTANCE = 5 / stageScale;
      if (minDistance <= HIT_DISTANCE && minIndex !== -1) {
        activePoints.splice(minIndex, 0, x, y);
      } else {
        activePoints.push(x, y);
      }
      newPolygons[activePolyIdx] = activePoints;
      setPolygons(newPolygons);
    }
  };

  // --- WIDOK MAPY ---
  if (step === 1) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header style={{ height: '60px', background: '#1a1a1a', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <h2>Krok 1: Wybierz lokalizację portu</h2>
        </header>
        <div style={{ flex: 1 }}>
          <Map {...viewState} onMove={evt => setViewState(evt.viewState)} mapStyle={getMapStyle(256) as any} style={{ width: '100%', height: '100%' }} dragRotate={false} />
        </div>
        <footer style={{ height: '80px', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button onClick={() => { resetEditorState(); setStep(2); }} style={{ padding: '15px 40px', fontSize: '18px', cursor: 'pointer', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px' }}>Otwórz Edytor</button>
        </footer>
      </div>
    );
  }

  // --- WIDOK EDYTORA ---
  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <header style={{ height: '70px', background: '#222', color: 'white', position: 'relative', display: 'flex', alignItems: 'center', padding: '0 15px', zIndex: 100, borderBottom: '1px solid #444', gap: '10px' }}>

        {/* GRUPA 1: POWRÓT I JAKOŚĆ */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={() => setStep(1)} style={{ padding: '8px 12px', background: '#444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}>Wróć</button>
          <select value={tileSize} onChange={(e) => setTileSize(Number(e.target.value))} style={{ padding: '7px 8px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '4px', fontSize: '13px' }}>
            <option value={256}>Jakość: Standard</option>
            <option value={128}>Jakość: HD</option>
            <option value={64}>Jakość: UHD</option>
            <option value={32}>Jakość: UHD+</option>
          </select>
        </div>

        {/* GRUPA 2: NOWE BOXY (INSTRUKCJA I STEROWANIE) */}
        <div style={{ display: 'flex', flex: 1, justifyContent: 'center', gap: '10px', alignItems: 'center' }}>

          {/* BOX: Sugestia modelowania */}
          <div style={{ background: '#ffeb3b', color: '#000', padding: '8px 15px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', border: '1px solid #fbc02d', boxShadow: '0 2px 4px rgba(0,0,0,0.2)', whiteSpace: 'nowrap' }}>
            💡 Próbuj modelować jak najprostszymi kształtami.
          </div>

          {/* BOX: Sterowanie (Hover) */}
          <div
            style={{ position: 'relative' }}
            onMouseEnter={() => setShowControls(true)}
            onMouseLeave={() => setShowControls(false)}
          >
            <div style={{ background: '#007bff', color: 'white', padding: '8px 15px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', cursor: 'help', border: '1px solid #0056b3' }}>
              ⌨️ Sterowanie
            </div>
            {showControls && (
              <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '10px', background: '#333', padding: '15px', borderRadius: '8px', width: '280px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', border: '1px solid #555', zIndex: 100 }}>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '12px', lineHeight: '1.8', color: '#eee' }}>
                  <li>🖱️ <strong>PPM:</strong> Przesuwanie mapy</li>
                  <li>🖱️ <strong>LPM:</strong> Dodaj kolejny punkt</li>
                  <li>🖱️ <strong>LPM blisko linii:</strong> Wstaw punkt na linii</li>
                  <li>🖱️ <strong>PPM na punkcie:</strong> Usuwanie punktu</li>
                  <li>⌨️ <strong>Shift + LPM:</strong> Nowy kształt</li>
                  <li>🖱️ <strong>Środkowy Przycisk:</strong> Wybierz kształt</li>
                  <li>⌨️ <strong>Ctrl + Z / Y:</strong> Cofnij / Ponów</li>
                  <li>🖱️ <strong>Ctrl + LPM:</strong> Punkt Startowy 🚩</li>
                  <li>🖱️ <strong>Kółko myszy na punkcie startowym:</strong> Obrót punktu startowego</li>
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* GRUPA 3: NARZĘDZIA I ZAPIS */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ fontSize: '11px', color: '#aaa', marginRight: '5px' }}>Shape: #{activePolyIdx + 1}</div>
          <button onClick={handleUndo} disabled={undoStack.length === 0} style={{ padding: '8px 10px', background: '#444', color: undoStack.length > 0 ? '#fff' : '#777', border: 'none', borderRadius: '4px', cursor: undoStack.length > 0 ? 'pointer' : 'default', fontSize: '13px' }}>↩</button>
          <button onClick={handleRedo} disabled={redoStack.length === 0} style={{ padding: '8px 10px', background: '#444', color: redoStack.length > 0 ? '#fff' : '#777', border: 'none', borderRadius: '4px', cursor: redoStack.length > 0 ? 'pointer' : 'default', fontSize: '13px' }}>↪</button>
          <button
            onClick={() => { if(window.confirm("Reset?")) { saveHistory(); setPolygons([[]]); setStartPoint(null); } }}
            style={{ padding: '8px 10px', background: '#c62828', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}
          >🗑️</button>
          <button
            onClick={() => !startPoint ? alert("Dodaj punkt startowy!") : alert("Zapisano!")}
            style={{ background: '#4CAF50', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px', marginLeft: '5px' }}
          >Zapisz</button>
        </div>
      </header>

      {/* OBSZAR ROBOCZY MAPY I KONVA */}
      <div style={{ flex: 1, position: 'relative' }}>
        <div style={{ position: 'absolute', width: '100%', height: '100%', transform: `translate(${stagePos.x}px, ${stagePos.y}px) scale(${stageScale})`, transformOrigin: '0 0', pointerEvents: 'none', zIndex: 1 }}>
          <Map interactive={false} {...viewState} mapStyle={getMapStyle(tileSize) as any} style={{ width: '100%', height: '100%' }} />
        </div>

        <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 5 }}>
          <Stage
            width={dimensions.width}
            height={dimensions.height - 70}
            onMouseDown={handleStageMouseDown}
            onMouseMove={(e) => isPanning && setStagePos(prev => ({ x: prev.x + e.evt.movementX, y: prev.y + e.evt.movementY }))}
            onMouseUp={() => setIsPanning(false)}
            onWheel={(e) => {
              const stage = e.target.getStage();
              const oldScale = stageScale;
              const pointer = stage!.getPointerPosition();
              if (!pointer) return;
              const mousePointTo = { x: (pointer.x - stagePos.x) / oldScale, y: (pointer.y - stagePos.y) / oldScale };
              const newScale = e.evt.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
              setStageScale(newScale);
              setStagePos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
            }}
            onContextMenu={(e) => e.evt.preventDefault()}
          >
            <Layer x={stagePos.x} y={stagePos.y} scaleX={stageScale} scaleY={stageScale}>
              {polygons.map((polyPoints, polyIdx) => (
                <Group key={polyIdx}>
                  <Line
                    points={polyPoints}
                    fill={polyIdx === activePolyIdx ? "rgba(0, 255, 0, 0.15)" : "rgba(128, 128, 128, 0.15)"}
                    stroke={polyIdx === activePolyIdx ? "#00ff00" : "#888888"}
                    strokeWidth={(polyIdx === activePolyIdx ? 2 : 1) / stageScale}
                    closed={polyPoints.length >= 6}
                    onMouseDown={(e) => { if (e.evt.button === 1) { setActivePolyIdx(polyIdx); e.cancelBubble = true; } }}
                  />
                  {polyIdx === activePolyIdx && Array.from({ length: polyPoints.length / 2 }).map((_, i) => (
                    <Circle
                      key={i} x={polyPoints[i * 2]} y={polyPoints[i * 2 + 1]}
                      radius={7 / stageScale} fill="white" stroke="#00ff00" strokeWidth={2 / stageScale}
                      draggable onDragStart={saveHistory}
                      onDragMove={(e) => {
                        const next = [...polygons];
                        next[polyIdx][i * 2] = e.target.x();
                        next[polyIdx][i * 2 + 1] = e.target.y();
                        setPolygons(next);
                      }}
                      onContextMenu={(e) => {
                        e.evt.preventDefault(); saveHistory();
                        const next = [...polygons]; const upd = [...next[polyIdx]];
                        upd.splice(i * 2, 2); next[polyIdx] = upd; setPolygons(next);
                      }}
                    />
                  ))}
                </Group>
              ))}

              {startPoint && (
                <Group
                  x={startPoint.x} y={startPoint.y} rotation={startPoint.rotation}
                  onWheel={(e) => {
                    e.cancelBubble = true; saveHistory();
                    const delta = e.evt.deltaY > 0 ? 15 : -15;
                    setStartPoint(prev => prev ? { ...prev, rotation: prev.rotation + delta } : null);
                  }}
                  draggable onDragStart={saveHistory}
                  onDragMove={(e) => setStartPoint(prev => prev ? { ...prev, x: e.target.x(), y: e.target.y() } : null)}
                >
                  <Arrow points={[0, 0, 25 / stageScale, 0]} pointerLength={10 / stageScale} pointerWidth={10 / stageScale} fill="#4CAF50" stroke="#4CAF50" strokeWidth={4 / stageScale} />
                  <Circle radius={8 / stageScale} fill="white" stroke="#4CAF50" strokeWidth={2 / stageScale} />
                </Group>
              )}
            </Layer>
          </Stage>
        </div>
      </div>
    </div>
  );
}

export default App;
