export interface StartPoint {
  x: number;
  y: number;
  rotation: number;
}

export interface EditorState {
  polygons: number[][];
  startPoint: StartPoint | null;
  activePolyIdx: number;
}

export type Step = 0 | 1 | 2 | 3 | 4;
export type EditorMode = 'mapping' | 'simulation';
export type PropHandedness = 'right' | 'left';
export type BoatPreset = 'standard' | 'small';

export interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
}

export interface SimState {
  x: number;
  y: number;
  rotation: number;
  u: number;
  v: number;
  r: number;
}

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
        portId?: number;
      }>;
      getPorts: (bounds: {
        minLng: number;
        minLat: number;
        maxLng: number;
        maxLat: number;
      }) => Promise<{
        success: boolean;
        ports: any[];
        message?: string;
      }>;
    };
  }
}
