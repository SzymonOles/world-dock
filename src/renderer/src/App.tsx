import { useState, useEffect, useCallback } from 'react';
import { PortSelector } from './components/PortSelector';
import { EditorView } from './components/EditorView';
import { ConfigScreen } from './components/ConfigScreen';
import { SimulationView } from './components/SimulationView';
import {Step, ViewState, EditorMode, StartPoint, EditorState, PropHandedness, BoatPreset} from './types';
import { getMetersPerPixel as getMppUtil } from './utils/geoUtils';
import 'maplibre-gl/dist/maplibre-gl.css';

function App() {
  const [step, setStep] = useState<Step>(0);
  const [boatPreset, setBoatPreset] = useState<BoatPreset>('standard');
  const [viewState, setViewState] = useState<ViewState>({ longitude: 18.66, latitude: 54.40, zoom: 8 });
  const [editorMode, setEditorMode] = useState<EditorMode>('mapping');
  const [tileSize, setTileSize] = useState<number>(256);
  const [ports, setPorts] = useState<any[]>([]);
  const [selectedPort, setSelectedPort] = useState<any>(null);

  // Stany edytora mapowania
  const [polygons, setPolygons] = useState<number[][]>([[]]);
  const [activePolyIdx, setActivePolyIdx] = useState<number>(0);
  const [startPoint, setStartPoint] = useState<StartPoint | null>(null);
  const [creationStart, setCreationStart] = useState<{ x: number, y: number, mode: 'no-deck' | 'deck' | 'boat' } | null>(null);

  // Historia operacji (Cofanie/Ponawianie)
  const [undoStack, setUndoStack] = useState<EditorState[]>([]);
  const [redoStack, setRedoStack] = useState<EditorState[]>([]);

  // Pozycjonowanie płótna roboczego Konva
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  // Parametry środowiskowe
  const [windDir, setWindDir] = useState<number>(0);
  const [windSpeed, setWindSpeed] = useState<number>(0);
  const [propHandedness, setPropHandedness] = useState<PropHandedness>('right');

  const [waitingForMap, setWaitingForMap] = useState(false);
  const [pendingStep, setPendingStep] = useState<Step | null>(null);

  useEffect(() => {
    const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const fetchVisiblePorts = async (view: ViewState) => {
    const bounds = {
      minLng: view.longitude - 2, maxLng: view.longitude + 2,
      minLat: view.latitude - 2, maxLat: view.latitude + 2
    };
    const res = await window.api.getPorts(bounds);
    if (res.success) setPorts(res.ports);
  };

  useEffect(() => {
    if (step === 0) fetchVisiblePorts(viewState);
  }, [step]);

  const getMetersPerPixel = useCallback(() => {
    return getMppUtil(viewState.latitude, viewState.zoom);
  }, [viewState]);

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
    const response = await window.api.savePortData(payload);
    if (response?.success) {
      alert("Pomyślnie zapisano projekt w bazie!");
      setStep(0);
    } else {
      alert("Błąd zapisu: " + (response?.message || "Nieznany błąd"));
    }
  };

  const loadPortForSimulation = async (portId: number) => {
    const res = await window.api.getPortDetails(portId);
    if (!res.success || !res.port) {
      alert(res.message || 'Nie udało się pobrać portu');
      return;
    }
    setViewState({ longitude: res.port.center_lng, latitude: res.port.center_lat, zoom: res.port.zoom_level });
    setTileSize(res.port.tile_quality);
    setStartPoint(res.port.start_point_json);
    setPolygons(res.shapes?.map((s: any) => s.raw_points) || [[]]);
    setEditorMode('simulation');
    setPendingStep(2);
    setWaitingForMap(true);
  };

  const openEditorForMapping = () => {
    setPolygons([[]]);
    setActivePolyIdx(0);
    setStartPoint(null);
    setUndoStack([]);
    setRedoStack([]);
    setEditorMode('mapping');
    setStep(2);
  };

  // Switcher Widoków (Router maszynowy)
  switch (step) {
    case 0:
    case 1:
      return (
        <PortSelector
          step={step} viewState={viewState} setViewState={setViewState}
          ports={ports} selectedPort={selectedPort} setSelectedPort={setSelectedPort}
          fetchVisiblePorts={fetchVisiblePorts} loadPortForSimulation={loadPortForSimulation}
          setStep={setStep} onOpenEditor={openEditorForMapping}
          waitingForMap={waitingForMap} setWaitingForMap={setWaitingForMap}
          pendingStep={pendingStep} setPendingStep={setPendingStep}
        />
      );
    case 2:
      return (
        <EditorView
          viewState={viewState} tileSize={tileSize} setTileSize={setTileSize}
          polygons={polygons} setPolygons={setPolygons} activePolyIdx={activePolyIdx}
          setActivePolyIdx={setActivePolyIdx} startPoint={startPoint} setStartPoint={setStartPoint}
          creationStart={creationStart} setCreationStart={setCreationStart} undoStack={undoStack}
          redoStack={redoStack} handleUndo={handleUndo} handleRedo={handleRedo}
          saveHistory={saveHistory} stageScale={stageScale} setStageScale={setStageScale}
          stagePos={stagePos} setStagePos={setStagePos} isPanning={isPanning}
          setIsPanning={setIsPanning} showControls={showControls} setShowControls={setShowControls}
          dimensions={dimensions} editorMode={editorMode} handleSave={handleSave}
          setStep={setStep} getMetersPerPixel={getMetersPerPixel}
        />
      );
    case 3:
      return (
        <ConfigScreen
          windDir={windDir} setWindDir={setWindDir} windSpeed={windSpeed}
          setWindSpeed={setWindSpeed} propHandedness={propHandedness}
          setPropHandedness={setPropHandedness} boatPreset={boatPreset}
          setBoatPreset={setBoatPreset} onBack={() => setStep(2)}
          onLaunch={() => setStep(4)}
        />
      );
    case 4:
      return (
        <SimulationView
          viewState={viewState} tileSize={tileSize} polygons={polygons}
          startPoint={startPoint} windDir={windDir} windSpeed={windSpeed}
          propHandedness={propHandedness} boatPreset={boatPreset}
          dimensions={dimensions} onBack={() => setStep(3)}
        />
      );
    default:
      return null;
  }
}

export default App;
