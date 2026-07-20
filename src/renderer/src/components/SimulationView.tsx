import React, { useState, useEffect, useRef } from 'react';
import Map from 'react-map-gl/maplibre';
import { Stage, Layer, Line, Group } from 'react-konva';
import { ViewState, StartPoint, PropHandedness, BoatPreset } from '../types';
import { getMapStyle, getMetersPerPixel,lineSegmentsIntersect , getSimBoatPoints, getClosestWallVector, isPointInPolygon } from '../utils/geoUtils';

interface SimulationViewProps {
  viewState: ViewState;
  tileSize: number;
  polygons: number[][];
  startPoint: StartPoint | null;
  windDir: number;
  windSpeed: number;
  propHandedness: PropHandedness;
  boatPreset: BoatPreset;
  dimensions: { width: number, height: number };
  onBack: () => void;
}

export const SimulationView: React.FC<SimulationViewProps> = ({
                                                                viewState, tileSize, polygons, startPoint, windDir, windSpeed, propHandedness, boatPreset, dimensions, onBack
                                                              }) => {
  const [simBoat, setSimBoat] = useState<{ x: number; y: number; rotation: number } | null>(null);
  const [throttle, setThrottle] = useState<number>(0);
  const [rudder, setRudder] = useState<number>(0);
  const [showMapBackground, setShowMapBackground] = useState<boolean>(true);
  const [isPanning, setIsPanning] = useState(false);
  const [isSteeringWithMouse, setIsSteeringWithMouse] = useState(false);
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

  const simThrottleRef = useRef(0);
  const simRudderRef = useRef(0);
  const currentRPMRef = useRef(0);
  const keysPressed = useRef<Set<string>>(new Set());
  const simStateRef = useRef({ x: 0, y: 0, rotation: 0, u: 0, v: 0, r: 0 });

  const resetSimulation = () => {
    if (startPoint) {
      simStateRef.current = { x: startPoint.x, y: startPoint.y, rotation: startPoint.rotation, u: 0, v: 0, r: 0 };
      setSimBoat({ x: startPoint.x, y: startPoint.y, rotation: startPoint.rotation });
    }
    simThrottleRef.current = 0;
    simRudderRef.current = 0;
    currentRPMRef.current = 0;
    setThrottle(0);
    setRudder(0);
  };

  useEffect(() => {
    resetSimulation();
    const handleKeyDown = (e: KeyboardEvent) => keysPressed.current.add(e.key.toLowerCase());
    const handleKeyUp = (e: KeyboardEvent) => keysPressed.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [startPoint, boatPreset]);

  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const updatePhysics = () => {
      const now = performance.now();
      let dt = (now - lastTime) / 1000;
      lastTime = now;
      if (dt > 0.1) dt = 0.1;

      if (keysPressed.current.has('w')) {
        simThrottleRef.current = Math.min(100, simThrottleRef.current + 60 * dt);
        setThrottle(Math.round(simThrottleRef.current));
      }
      if (keysPressed.current.has('s')) {
        simThrottleRef.current = Math.max(-50, simThrottleRef.current - 60 * dt);
        setThrottle(Math.round(simThrottleRef.current));
      }
      if (keysPressed.current.has('a')) {
        simRudderRef.current = Math.max(-45, simRudderRef.current - 70 * dt);
        setRudder(Math.round(simRudderRef.current));
      }
      if (keysPressed.current.has('d')) {
        simRudderRef.current = Math.min(45, simRudderRef.current + 70 * dt);
        setRudder(Math.round(simRudderRef.current));
      }

      const state = simStateRef.current;
      const mpp = getMetersPerPixel(viewState.latitude, viewState.zoom);
      const psi = (state.rotation * Math.PI) / 180;

      currentRPMRef.current += (simThrottleRef.current - currentRPMRef.current) * 1.8 * dt;

      // ==========================================================
      // SELEKCJA PARAMETRÓW MODELU HYDRODYNAMICZNEGO (MMG)
      // ==========================================================
      const isSmall = boatPreset === 'small';
      const currentBoatLen = isSmall ? 4.0 : 5.5;

      const m = isSmall ? 450 : 1000;
      const Iz = isSmall ? 600 : 2500;
      const mx = isSmall ? 45 : 180;
      const my = isSmall ? 675 : 1760;
      const Jz = isSmall ? 660 : 3000;

      const Mx = m + mx;
      const My = m + my;
      const Itotal = Iz + Jz;
      const armDist = isSmall ? -1.6 : -2.2; // Ramię siły od środka ciężkości do rufy

      const windDirRad = (windDir * Math.PI) / 180;
      const Vc = 0.02 * windSpeed;
      const uc = Vc * Math.cos(windDirRad) * Math.cos(psi) + Vc * Math.sin(windDirRad) * Math.sin(psi);
      const vc = -Vc * Math.cos(windDirRad) * Math.sin(psi) + Vc * Math.sin(windDirRad) * Math.cos(psi);

      const ur = state.u - uc, vr = state.v - vc;

      // Opory kadłuba (Damping)
      const XH = (isSmall ? -40 : -85) * ur * Math.abs(ur);
      const YH = (isSmall ? -850 : -1500) * vr * Math.abs(vr);
      const NH = (isSmall ? -1800 : -4800) * state.r * Math.abs(state.r);

      // Efekt brzegowy (Bank effect)
      let X_bank = 0, Y_bank = 0, N_bank = 0;
      const halfLenPixels = (currentBoatLen / 2) / mpp;
      const bowX = state.x + halfLenPixels * Math.cos(psi);
      const bowY = state.y + halfLenPixels * Math.sin(psi);
      const bowWall = getClosestWallVector(bowX, bowY, polygons);

      if (ur > 0.1 && bowWall.dist * mpp < 5.0 && bowWall.dist * mpp > 0.1) {
        const F_mag = (isSmall ? 600 : 1200) * (ur * ur) * (1.0 / (bowWall.dist * mpp) - 1.0 / 5.0);
        X_bank += F_mag * ((bowX - bowWall.x) * Math.cos(psi) + (bowY - bowWall.y) * Math.sin(psi)) / bowWall.dist;
        Y_bank += F_mag * (-(bowX - bowWall.x) * Math.sin(psi) + (bowY - bowWall.y) * Math.cos(psi)) / bowWall.dist;
        N_bank += Y_bank * Math.abs(armDist);
      }

      // Napęd (Ciąg dopasowany do wagi jednostki)
      const maxForwardThrust = isSmall ? 2200 : 3800;
      const maxBackwardThrust = isSmall ? 1000 : 1800;
      let XP = currentRPMRef.current >= 0
        ? (currentRPMRef.current / 100) * maxForwardThrust
        : (currentRPMRef.current / 50) * maxBackwardThrust;

      const propWalkCoeff = isSmall ? -0.4 : -0.7;
      const YP = propWalkCoeff * currentRPMRef.current * (propHandedness === 'right' ? 1 : -1);
      const NP = YP * armDist;

      // Siły steru
      const deltaRad = (simRudderRef.current * Math.PI) / 180;
      const VR2 = (ur * ur) + Math.max(0, currentRPMRef.current) * 0.35;
      const rudderLiftCoeff = isSmall ? -12.0 : -22.0;
      const YR = rudderLiftCoeff * VR2 * Math.sin(deltaRad);
      const XR = rudderLiftCoeff * VR2 * (1 - Math.cos(deltaRad));
      const NR = YR * armDist;

      // Aerodynamika (Opór wiatru kadłuba)
      const windXArea = isSmall ? 1.0 : 1.5;
      const windYArea = isSmall ? 2.5 : 4.0;
      const XW = 0.5 * 1.2 * windXArea * (windSpeed * windSpeed) * Math.cos(windDirRad - psi);
      const YW = 0.5 * 1.2 * windYArea * (windSpeed * windSpeed) * Math.sin(windDirRad - psi);
      const NW = YW * (isSmall ? 0.2 : 0.4);

      const dot_u = (XH + XP + XR + XW + X_bank + My * state.v * state.r) / Mx;
      const dot_v = (YH + YP + YR + YW + Y_bank - Mx * state.u * state.r) / My;
      const dot_r = (NH + NP + NR + NW + N_bank) / Itotal;

      state.u += dot_u * dt;
      state.v += dot_v * dt;
      state.r += dot_r * dt;

      const nextRotation = state.rotation + (state.r * (180 / Math.PI)) * dt;
      const radNext = (nextRotation * Math.PI) / 180;
      const nextX = state.x + ((state.u * Math.cos(radNext) - state.v * Math.sin(radNext)) * dt) / mpp;
      const nextY = state.y + ((state.u * Math.sin(radNext) + state.v * Math.cos(radNext)) * dt) / mpp;

      // Sprawdzanie kolizji
      let collision = false;
      const localPts = getSimBoatPoints(mpp, boatPreset);
      const worldBoatPts: { x: number; y: number }[] = [];

      // 1. Wylicz pozycję wszystkich wierzchołków łodzi w układzie świata
      for (let i = 0; i < localPts.length; i += 2) {
        worldBoatPts.push({
          x: nextX + (localPts[i] * Math.cos(radNext) - localPts[i + 1] * Math.sin(radNext)),
          y: nextY + (localPts[i] * Math.sin(radNext) + localPts[i + 1] * Math.cos(radNext))
        });
      }

      // 2. Test punktu w wielokącie (czy któryś róg łodzi wszedł pod teksturę)
      for (const pt of worldBoatPts) {
        if (polygons.some(poly => isPointInPolygon(pt.x, pt.y, poly))) {
          collision = true;
          break;
        }
      }

      // 3. Test przecięcia krawędzi (zapobiega przenikaniu burt przez ściany)
      if (!collision) {
        outerCollisionLoop:
          for (const poly of polygons) {
            if (poly.length < 6) continue;

            // Iteracja przez krawędzie łodzi
            for (let b = 0; b < worldBoatPts.length; b++) {
              const b1 = worldBoatPts[b];
              const b2 = worldBoatPts[(b + 1) % worldBoatPts.length];

              // Iteracja przez krawędzie przeszkody na mapie
              for (let p = 0; p < poly.length; p += 2) {
                const p1x = poly[p];
                const p1y = poly[p + 1];
                const p2idx = (p + 2) % poly.length;
                const p2x = poly[p2idx];
                const p2y = poly[p2idx + 1];

                if (lineSegmentsIntersect(b1.x, b1.y, b2.x, b2.y, p1x, p1y, p2x, p2y)) {
                  collision = true;
                  break outerCollisionLoop;
                }
              }
            }
          }
      }

      // Zastosowanie wyniku kolizji
      if (collision) {
        state.u = 0;
        state.v = 0;
        state.r = 0;
      } else {
        state.x = nextX;
        state.y = nextY;
        state.rotation = nextRotation;
      }

      if (collision) {
        state.u = 0; state.v = 0; state.r = 0;
      } else {
        state.x = nextX; state.y = nextY; state.rotation = nextRotation;
      }

      setSimBoat({ x: state.x, y: state.y, rotation: state.rotation });
      animId = requestAnimationFrame(updatePhysics);
    };

    animId = requestAnimationFrame(updatePhysics);
    return () => cancelAnimationFrame(animId);
  }, [polygons, viewState, windDir, windSpeed, propHandedness, boatPreset]);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <header style={{ height: '70px', background: '#111', display: 'flex', alignItems: 'center', padding: '0 20px', borderBottom: '1px solid #333', zIndex: 100, gap: '15px' }}>
        <button onClick={onBack} style={{ padding: '8px 12px', background: '#444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Wróć</button>
        <button onClick={resetSimulation} style={{ padding: '8px 16px', background: '#dc3545', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>🔄 Resetuj</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fff', fontSize: '13px', cursor: 'pointer', background: '#222', padding: '7px 14px', borderRadius: '4px', border: '1px solid #444' }}>
          <input type="checkbox" checked={showMapBackground} onChange={(e) => setShowMapBackground(e.target.checked)} /> 🗺️ Pokaż mapę satelitarną
        </label>
      </header>

      <div style={{ flex: 1, position: 'relative', background: showMapBackground ? '#000' : '#1a3a5f' }}>
        {showMapBackground && (
          <div style={{ position: 'absolute', width: '100%', height: '100%', transform: `translate(${stagePos.x}px, ${stagePos.y}px) scale(${stageScale})`, transformOrigin: '0 0', pointerEvents: 'none' }}>
            <Map interactive={false} {...viewState} mapStyle={getMapStyle(tileSize) as any} style={{ width: '100%', height: '100%' }} />
          </div>
        )}

        <Stage
          width={dimensions.width} height={dimensions.height - 70}
          onMouseDown={(e) => {
            if (e.evt.button === 0) setIsSteeringWithMouse(true);
            else if (e.evt.button === 1) { e.evt.preventDefault(); simThrottleRef.current = 0; setThrottle(0); }
            else if (e.evt.button === 2) setIsPanning(true);
          }}
          onMouseMove={(e) => {
            if (isPanning) setStagePos(prev => ({ x: prev.x + e.evt.movementX, y: prev.y + e.evt.movementY }));
            if (isSteeringWithMouse) {
              simRudderRef.current = Math.max(-45, Math.min(45, simRudderRef.current + e.evt.movementX * 0.15));
              setRudder(Math.round(simRudderRef.current));
            }
          }}
          onMouseUp={() => { setIsPanning(false); setIsSteeringWithMouse(false); }}
          onWheel={(e) => {
            if (e.evt.ctrlKey || e.evt.metaKey) {
              const stage = e.target.getStage();
              const oldScale = stageScale;
              const pointer = stage?.getPointerPosition();
              if (!pointer) return;
              const mousePointTo = { x: (pointer.x - stagePos.x) / oldScale, y: (pointer.y - stagePos.y) / oldScale };
              const newScale = e.evt.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
              setStageScale(newScale);
              setStagePos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
            } else {
              simThrottleRef.current = Math.max(-50, Math.min(100, simThrottleRef.current + (e.evt.deltaY < 0 ? 5 : -5)));
              setThrottle(Math.round(simThrottleRef.current));
            }
          }}
        >
          <Layer x={stagePos.x} y={stagePos.y} scaleX={stageScale} scaleY={stageScale}>
            {polygons.map((polyPoints, polyIdx) => (
              <Line key={polyIdx} points={polyPoints} fill="rgba(255, 255, 255, 0.15)" stroke="rgba(255, 255, 255, 0.5)" strokeWidth={1 / stageScale} closed={polyPoints.length >= 6} />
            ))}
            {simBoat && (
              <Group x={simBoat.x} y={simBoat.y} rotation={simBoat.rotation}>
                <Line points={getSimBoatPoints(getMetersPerPixel(viewState.latitude, viewState.zoom), boatPreset)} fill="rgba(0, 123, 255, 0.75)" stroke="#007bff" strokeWidth={2 / stageScale} closed={true} />
              </Group>
            )}
          </Layer>
        </Stage>

        <div style={{ position: 'absolute', top: '20px', left: '20px', background: 'rgba(20, 20, 20, 0.9)', padding: '15px', borderRadius: '6px', color: '#eee', fontSize: '12px', fontFamily: 'monospace' }}>
          <strong style={{ color: '#4CAF50' }}>TELEMETRIA REAL-TIME ({boatPreset === 'small' ? 'Mała' : 'Standard'}):</strong>
          <div>⚡ RPM Silnika: <span style={{ color: '#ff9800' }}>{currentRPMRef.current.toFixed(0)}%</span></div>
          <div>Węzeł u: <span>{simStateRef.current.u.toFixed(2)} m/s</span></div>
          <div>Węzeł v: <span>{simStateRef.current.v.toFixed(2)} m/s</span></div>
          <div>Yaw Rate (r): <span>{(simStateRef.current.r * (180 / Math.PI)).toFixed(1)} °/s</span></div>
        </div>

        <div style={{ position: 'absolute', right: '30px', top: '50%', transform: 'translateY(-50%)', width: '65px', height: '260px', background: 'rgba(25, 25, 25, 0.9)', border: '2px solid #444', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '15px 5px', color: 'white', fontFamily: 'monospace' }}>
          <div style={{ fontSize: '10px', color: '#ff4d4d' }}>NAPRZÓD</div>
          <div style={{ position: 'relative', width: '4px', height: '150px', background: '#333' }}>
            <div style={{ position: 'absolute', bottom: `${((throttle + 50) / 150) * 100}%`, left: '-18px', width: '40px', height: '4px', background: throttle >= 0 ? '#4CAF50' : '#ff9800' }} />
          </div>
          <div style={{ fontSize: '10px', color: '#4da6ff' }}>WSTECZ</div>
          <div>{throttle}%</div>
        </div>

        <div style={{ position: 'absolute', bottom: '25px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(25, 25, 25, 0.9)', border: '2px solid #444', borderRadius: '8px', padding: '12px 25px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <svg width="160" height="85">
            <path d="M 10 80 A 70 70 0 0 1 150 80" fill="none" stroke="#444" strokeWidth="4" />
            <g transform={`rotate(${rudder}, 80, 80)`}>
              <line x1="80" y1="80" x2="80" y2="20" stroke="#4CAF50" strokeWidth="4" />
            </g>
          </svg>
          <div style={{ color: '#fff', fontSize: '13px', fontFamily: 'monospace', marginTop: '6px' }}>
            STER: {Math.abs(rudder)}° {rudder === 0 ? '0' : rudder > 0 ? 'PRAWA' : 'LEWA'}
          </div>
        </div>
      </div>
    </div>
  );
};
