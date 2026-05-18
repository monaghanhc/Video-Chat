import type { AppSettings } from '@deskcall/shared';

const localSignalingUrls = new Set(['http://localhost:4000', 'http://127.0.0.1:4000']);

export function normalizePersistedSettings(
  storedSettings: Partial<AppSettings>,
  defaultSettings: AppSettings,
  hostname: string
): AppSettings {
  const mergedSettings = {
    ...defaultSettings,
    ...storedSettings
  };

  const isProductionWebHost = hostname !== 'localhost' && hostname !== '127.0.0.1';

  if (isProductionWebHost && localSignalingUrls.has(mergedSettings.signalingServerUrl)) {
    return {
      ...mergedSettings,
      signalingServerUrl: defaultSettings.signalingServerUrl
    };
  }

  return mergedSettings;
}
