import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.MAIN_VITE_SUPABASE_URL,
  import.meta.env.MAIN_VITE_SUPABASE_PUBLISHABLE_KEY,
);

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.maximize()

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // --- HANDLER: Pobieranie portów ---
  ipcMain.handle('get-ports', async (_event, bounds) => {
    try {
      const { data, error } = await supabase
        .from('port_maps')
        .select('id, name, center_lng, center_lat')
        .gte('center_lng', bounds.minLng)
        .lte('center_lng', bounds.maxLng)
        .gte('center_lat', bounds.minLat)
        .lte('center_lat', bounds.maxLat)
        .limit(100);

      if (error) throw error;
      return { success: true, ports: data };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

// main/index.ts
  ipcMain.handle('save-port-map', async (_event, payload) => {
    try {
      const { data: portData, error: portError } = await supabase
        .from('port_maps')
        .insert([{
          name: "WorldDock Port",
          center_lng: payload.location.lng,
          center_lat: payload.location.lat,
          zoom_level: payload.zoom,
          tile_quality: payload.quality,
          start_point_json: payload.startPoint
        }])
        .select()
        .single();

      if (portError) throw portError;

      // Mapowanie poligonów (zmieniono z payload.shapes na payload.polygons)
      const shapesToInsert = payload.polygons.map((poly: any) => ({
        port_id: portData.id,
        raw_points: poly // poly to tablica [x1, y1, x2, y2...]
      }));

      const { error: shapesError } = await supabase
        .from('port_shapes')
        .insert(shapesToInsert);

      if (shapesError) throw shapesError;

      return { success: true };
    } catch (err: any) {
      console.error('Błąd zapisu:', err);
      return {
        success: false,
        message: err.message || 'Błąd komunikacji z bazą'
      };
    }
  });

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
