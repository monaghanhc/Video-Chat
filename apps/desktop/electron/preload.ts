import { contextBridge, ipcRenderer } from 'electron';

interface AppSettings {
  signalingServerUrl: string;
  preferredCameraId?: string;
  preferredMicrophoneId?: string;
  preferredSpeakerId?: string;
}

contextBridge.exposeInMainWorld('deskcall', {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('deskcall:get-settings'),
  setSettings: (settings: AppSettings): Promise<AppSettings> =>
    ipcRenderer.invoke('deskcall:set-settings', settings)
});
