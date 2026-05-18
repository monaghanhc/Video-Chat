import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

interface AppSettings {
  signalingServerUrl: string;
  preferredCameraId?: string;
  preferredMicrophoneId?: string;
  preferredSpeakerId?: string;
}

const defaultSettings: AppSettings = {
  signalingServerUrl:
    process.env.DESKCALL_SIGNALING_SERVER_URL ?? 'https://deskcall-signaling.onrender.com'
};

let mainWindow: BrowserWindow | null = null;

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function readSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    return {
      ...defaultSettings,
      ...(JSON.parse(raw) as Partial<AppSettings>)
    };
  } catch {
    return defaultSettings;
  }
}

async function writeSettings(nextSettings: AppSettings): Promise<AppSettings> {
  const normalizedSettings: AppSettings = {
    signalingServerUrl: nextSettings.signalingServerUrl || defaultSettings.signalingServerUrl,
    preferredCameraId: nextSettings.preferredCameraId,
    preferredMicrophoneId: nextSettings.preferredMicrophoneId,
    preferredSpeakerId: nextSettings.preferredSpeakerId
  };

  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(normalizedSettings, null, 2), 'utf8');

  return normalizedSettings;
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 720,
    title: 'DeskCall',
    backgroundColor: '#09090b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture');
  });

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window']
      });

      callback({
        video: sources[0]
      });
    },
    {
      useSystemPicker: true
    }
  );

  ipcMain.handle('deskcall:get-settings', () => readSettings());
  ipcMain.handle('deskcall:set-settings', (_event, nextSettings: AppSettings) =>
    writeSettings(nextSettings)
  );

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
