import React from 'react';
import { PropHandedness, BoatPreset } from '../types';

interface ConfigScreenProps {
  windDir: number;
  setWindDir: (d: number) => void;
  windSpeed: number;
  setWindSpeed: (s: number) => void;
  propHandedness: PropHandedness;
  setPropHandedness: (p: PropHandedness) => void;
  boatPreset: BoatPreset;
  setBoatPreset: (b: BoatPreset) => void;
  onBack: () => void;
  onLaunch: () => void;
}

export const ConfigScreen: React.FC<ConfigScreenProps> = ({
                                                            windDir, setWindDir,
                                                            windSpeed, setWindSpeed,
                                                            propHandedness, setPropHandedness,
                                                            boatPreset, setBoatPreset,
                                                            onBack, onLaunch
                                                          }) => {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#111', color: 'white', display: 'flex', flexDirection: 'column' }}>
      <header style={{ height: '70px', background: '#222', display: 'flex', alignItems: 'center', padding: '0 20px', borderBottom: '1px solid #444' }}>
        <button onClick={onBack} style={{ padding: '8px 12px', background: '#444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Wróć</button>
        <h2 style={{ marginLeft: '20px' }}>Konfiguracja parametrów środowiskowych i napędu</h2>
      </header>

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
        <div style={{ background: '#1e1e1e', padding: '30px', borderRadius: '12px', border: '1px solid #333', width: '450px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>

          <div style={{ marginBottom: '22px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#bbb', fontSize: '14px' }}>
              🚢 Typ jednostki:
            </label>
            <select
              value={boatPreset}
              onChange={(e) => setBoatPreset(e.target.value as BoatPreset)}
              style={{
                width: '100%', padding: '10px', background: '#2a2a2a', color: 'white',
                border: '1px solid #444', borderRadius: '6px', cursor: 'pointer', fontSize: '14px'
              }}
            >
              <option value="standard">Standardowa motorówka (5.5m x 1.85m | 1000kg)</option>
              <option value="small">Mniejsza jednostka (4.0m x 1.25m | 450kg)</option>
            </select>
          </div>

          <div style={{ marginBottom: '22px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#bbb', fontSize: '14px' }}>
              🌬️ Kierunek wiatru rzeczywistego: <span style={{ color: '#4CAF50', fontFamily: 'monospace' }}>{windDir}°</span>
            </label>
            <input
              type="range" min="0" max="359" value={windDir}
              onChange={(e) => setWindDir(Number(e.target.value))}
              style={{ width: '100%', cursor: 'pointer' }}
            />
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
          </div>

          <div style={{ marginBottom: '30px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#bbb', fontSize: '14px' }}>
              ⚙️ Skrętność śruby napędowej:
            </label>
            <select
              value={propHandedness}
              onChange={(e) => setPropHandedness(e.target.value as PropHandedness)}
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
            onClick={onLaunch}
            style={{
              width: '100%', padding: '15px', fontSize: '18px', background: '#4CAF50',
              border: 'none', borderRadius: '6px', color: 'white', cursor: 'pointer',
              fontWeight: 'bold', boxShadow: '0 4px 12px rgba(76, 175, 80, 0.3)'
            }}
          >
            Uruchom Symulator ▶
          </button>

        </div>
      </div>
    </div>
  );
};
