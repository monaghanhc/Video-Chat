import type { AppSettings } from '@deskcall/shared';

declare global {
  interface Window {
    deskcall?: {
      getSettings: () => Promise<AppSettings>;
      setSettings: (settings: AppSettings) => Promise<AppSettings>;
    };
  }
}

export {};
