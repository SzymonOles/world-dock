import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

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

  // JEDEN handler dla zapisu portu (Symulacja)
  ipcMain.handle('save-port-map', async (_event, portData) => {
    console.log('--- SYMULACJA ZAPISU DO BAZY POSTGRES ---');
    console.log('Dane odebrane:', JSON.stringify(portData, null, 2));

    // Udajemy opóźnienie sieciowe/zapisu (1.5 sekundy)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Zwracamy sukces
    return {
      success: true,
      message: "Dane pomyślnie zapisane w (symulowanej) bazie PostGIS",
      receivedId: Math.floor(Math.random() * 1000)
    };
  });

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
