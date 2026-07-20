import React from 'react';
import Map, { Marker, Popup } from 'react-map-gl/maplibre';
import { ViewState, Step } from '../types';
import { getMapStyle } from '../utils/geoUtils';

interface PortSelectorProps {
  step: Step;
  viewState: ViewState;
  setViewState: (v: ViewState) => void;
  ports: any[];
  selectedPort: any;
  setSelectedPort: (p: any) => void;
  fetchVisiblePorts: (v: ViewState) => void;
  loadPortForSimulation: (id: number) => void;
  setStep: (s: Step) => void;
  onOpenEditor: () => void;
  waitingForMap: boolean;
  setWaitingForMap: (b: boolean) => void;
  pendingStep: Step | null;
  setPendingStep: (s: Step | null) => void;
}

export const PortSelector: React.FC<PortSelectorProps> = ({
                                                            step,
                                                            viewState,
                                                            setViewState,
                                                            ports,
                                                            selectedPort,
                                                            setSelectedPort,
                                                            fetchVisiblePorts,
                                                            loadPortForSimulation,
                                                            setStep,
                                                            onOpenEditor,
                                                            waitingForMap,
                                                            setWaitingForMap,
                                                            pendingStep,
                                                            setPendingStep
                                                          }) => {
  if (step === 0) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header style={{ height: '60px', background: '#1a1a1a', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <h2>Moje Porty</h2>
        </header>
        <div style={{ flex: 1, position: 'relative' }}>
          <Map
            {...viewState}
            onMove={evt => { setViewState(evt.viewState); fetchVisiblePorts(evt.viewState); }}
            mapStyle={getMapStyle(256) as any}
            style={{ width: '100%', height: '100%' }}
            dragRotate={false}
            onRender={() => {
              if (!waitingForMap || pendingStep === null) return;
              setStep(pendingStep);
              setPendingStep(null);
              setWaitingForMap(false);
            }}
          >
            {ports.map(port => (
              <Marker key={port.id} longitude={port.center_lng} latitude={port.center_lat} onClick={e => { e.originalEvent.stopPropagation(); setSelectedPort(port); }}>
                <div style={{ cursor: 'pointer', fontSize: '24px' }}>🚩</div>
              </Marker>
            ))}
            {selectedPort && (
              <Popup longitude={selectedPort.center_lng} latitude={selectedPort.center_lat} anchor="bottom" onClose={() => setSelectedPort(null)}>
                <div style={{ padding: '5px', textAlign: 'center' }}>
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

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ height: '70px', background: '#222', color: 'white', display: 'flex', alignItems: 'center', padding: '0 15px', borderBottom: '1px solid #444', position: 'relative' }}>
        <button onClick={() => setStep(0)} style={{ padding: '8px 12px', background: '#444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', zIndex: 10 }}>Wróć</button>
        <h2 style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', fontSize: '18px', margin: 0, pointerEvents: 'none' }}>Krok 1: Wybierz lokalizację portu</h2>
      </header>
      <div style={{ flex: 1 }}>
        <Map {...viewState} onMove={evt => setViewState(evt.viewState)} mapStyle={getMapStyle(256) as any} style={{ width: '100%', height: '100%' }} dragRotate={false} />
      </div>
      <footer style={{ height: '80px', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <button onClick={onOpenEditor} style={{ padding: '15px 40px', fontSize: '18px', cursor: 'pointer', background: '#4CAF50', color: 'white', border: 'none', borderRadius: '5px' }}>Otwórz Edytor</button>
      </footer>
    </div>
  );
};
