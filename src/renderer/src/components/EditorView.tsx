import React, { useEffect } from 'react';
import Map from 'react-map-gl/maplibre';
import { Stage, Layer, Line, Circle, Group, Arrow } from 'react-konva';
import Konva from 'konva';
import { ViewState, StartPoint, Step } from '../types';
import { getMapStyle, generateBoatPoints, generateBoomPoints } from '../utils/geoUtils';

interface EditorViewProps {
  viewState: ViewState;
  tileSize: number;
  setTileSize: (s: number) => void;
  polygons: number[][];
  setPolygons: (p: number[][]) => void;
  activePolyIdx: number;
  setActivePolyIdx: (i: number) => void;
  startPoint: StartPoint | null;
  setStartPoint: React.Dispatch<React.SetStateAction<StartPoint | null>>;
  creationStart: { x: number, y: number, mode: 'no-deck' | 'deck' | 'boat' } | null;
  setCreationStart: (val: any) => void;
  undoStack: any[];
  redoStack: any[];
  handleUndo: () => void;
  handleRedo: () => void;
  saveHistory: () => void;
  stageScale: number;
  setStageScale: (s: number) => void;
  stagePos: { x: number, y: number };
  setStagePos: React.Dispatch<React.SetStateAction<{ x: number, y: number }>>;
  isPanning: boolean;
  setIsPanning: (p: boolean) => void;
  showControls: boolean;
  setShowControls: (c: boolean) => void;
  dimensions: { width: number, height: number };
  editorMode: 'mapping' | 'simulation';
  handleSave: () => void;
  setStep: (s: Step) => void;
  getMetersPerPixel: () => number;
}

export const EditorView: React.FC<EditorViewProps> = ({
                                                        viewState, tileSize, setTileSize, polygons, setPolygons, activePolyIdx, setActivePolyIdx,
                                                        startPoint, setStartPoint, creationStart, setCreationStart, undoStack, redoStack,
                                                        handleUndo, handleRedo, saveHistory, stageScale, setStageScale, stagePos, setStagePos,
                                                        isPanning, setIsPanning, showControls, setShowControls, dimensions, editorMode,
                                                        handleSave, setStep, getMetersPerPixel
                                                      }) => {

  // Globalny nasłuch klawiatury dla Ctrl+Z oraz Ctrl+Y
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (isCtrl) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          handleUndo();
        } else if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          handleRedo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undoStack, redoStack, polygons, startPoint, activePolyIdx]);

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
      const mpp = getMetersPerPixel();

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
          pts = generateBoatPoints({ x: creationStart.x, y: creationStart.y }, { x, y }, mpp);
        } else {
          pts = generateBoomPoints({ x: creationStart.x, y: creationStart.y }, { x, y }, creationStart.mode, mpp);
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

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <header style={{ height: '70px', background: '#222', color: 'white', position: 'relative', display: 'flex', alignItems: 'center', padding: '0 15px', zIndex: 100, borderBottom: '1px solid #444', gap: '10px' }}>
        <button onClick={() => setStep(0)} style={{ padding: '8px 12px', background: '#444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Wróć</button>
        <select value={tileSize} onChange={(e) => setTileSize(Number(e.target.value))} style={{ padding: '7px 8px', background: '#333', color: 'white', border: '1px solid #555', borderRadius: '4px' }}>
          <option value={256}>Jakość: Standard</option>
          <option value={128}>Jakość: HD</option>
          <option value={64}>Jakość: UHD</option>
          <option value={32}>Jakość: UHD+</option>
        </select>

        <div style={{ display: 'flex', flex: 1, justifyContent: 'center', gap: '10px', alignItems: 'center' }}>
          {creationStart && <div style={{ background: '#ff9800', color: '#000', padding: '8px 15px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>📍 {creationStart.mode === 'boat' ? 'Wskaż dziób łodzi' : 'Wskaż koniec bomu'}</div>}
          <div onMouseEnter={() => setShowControls(true)} onMouseLeave={() => setShowControls(false)} style={{ position: 'relative' }}>
            <div style={{ background: '#007bff', color: 'white', padding: '8px 15px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold', cursor: 'help' }}>Sterowanie</div>
            {showControls && (
              <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '10px', background: '#333', padding: '15px', borderRadius: '8px', width: '365px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', border: '1px solid #555', zIndex: 100 }}>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: '12px', lineHeight: '1.8', color: '#eee' }}>
                  <li>Template text replacement test</li>
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
                </ul>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={handleUndo} disabled={undoStack.length === 0} style={{ padding: '8px 10px', background: '#444', color: undoStack.length > 0 ? '#fff' : '#777', border: 'none', borderRadius: '4px' }}>↩</button>
          <button onClick={handleRedo} disabled={redoStack.length === 0} style={{ padding: '8px 10px', background: '#444', color: redoStack.length > 0 ? '#fff' : '#777', border: 'none', borderRadius: '4px' }}>↪</button>
          {editorMode === 'mapping' ? (
            <button onClick={handleSave} style={{ background: '#4CAF50', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Zapisz</button>
          ) : (
            <button onClick={() => setStep(3)} style={{ background: '#2196F3', color: 'white', border: 'none', padding: '8px 20px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Kontynuuj</button>
          )}
        </div>
      </header>

      <div style={{ flex: 1, position: 'relative', background: '#000' }}>
        <div style={{ position: 'absolute', width: '100%', height: '100%', transform: `translate(${stagePos.x}px, ${stagePos.y}px) scale(${stageScale})`, transformOrigin: '0 0', pointerEvents: 'none' }}>
          <Map interactive={false} {...viewState} mapStyle={getMapStyle(tileSize) as any} style={{ width: '100%', height: '100%' }} />
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
                  points={polyPoints} fill={polyIdx === activePolyIdx ? "rgba(0, 255, 0, 0.25)" : "rgba(255, 255, 255, 0.1)"}
                  stroke={polyIdx === activePolyIdx ? "#00ff00" : "#ffffff"} strokeWidth={(polyIdx === activePolyIdx ? 2 : 1) / stageScale}
                  closed={polyPoints.length >= 6} onMouseDown={(e) => { if (e.evt.button === 1) { setActivePolyIdx(polyIdx); e.cancelBubble = true; } }}
                />
                {polyIdx === activePolyIdx && Array.from({ length: polyPoints.length / 2 }).map((_, i) => (
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
                draggable onDragStart={saveHistory} onDragMove={(e) => setStartPoint(prev => prev ? { ...prev, x: e.target.x(), y: e.target.y() } : null)}
              >
                <Arrow points={[0, 0, 30 / stageScale, 0]} pointerLength={10 / stageScale} pointerWidth={10 / stageScale} fill="#4CAF50" stroke="#4CAF50" strokeWidth={3 / stageScale} />
                <Circle radius={6 / stageScale} fill="white" stroke="#4CAF50" strokeWidth={2 / stageScale} />
              </Group>
            )}
          </Layer>
        </Stage>
      </div>
    </div>
  );
};
