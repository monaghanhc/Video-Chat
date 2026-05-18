import { useCallback, useEffect, useState } from 'react';

interface MediaDeviceState {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
  refresh: () => Promise<void>;
  supportsSpeakerSelection: boolean;
}

export function useMediaDevices(): MediaDeviceState {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);

  const updateDevices = useCallback((devices: MediaDeviceInfo[]) => {
    setCameras(devices.filter((device) => device.kind === 'videoinput'));
    setMicrophones(devices.filter((device) => device.kind === 'audioinput'));
    setSpeakers(devices.filter((device) => device.kind === 'audiooutput'));
  }, []);

  const refresh = useCallback(async () => {
    updateDevices(await navigator.mediaDevices.enumerateDevices());
  }, [updateDevices]);

  useEffect(() => {
    void navigator.mediaDevices.enumerateDevices().then(updateDevices);

    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [refresh, updateDevices]);

  return {
    cameras,
    microphones,
    speakers,
    refresh,
    supportsSpeakerSelection: 'setSinkId' in HTMLMediaElement.prototype
  };
}
