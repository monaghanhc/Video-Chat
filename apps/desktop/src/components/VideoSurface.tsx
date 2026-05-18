import { useEffect, useRef } from 'react';
import { CameraOff } from 'lucide-react';
import { cn } from '../lib/utils';

interface VideoSurfaceProps {
  stream: MediaStream | null;
  muted?: boolean;
  label: string;
  placeholder?: string;
  className?: string;
  sinkId?: string;
}

export function VideoSurface({
  stream,
  muted = false,
  label,
  placeholder,
  className,
  sinkId
}: VideoSurfaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current as (HTMLVideoElement & {
      setSinkId?: (deviceId: string) => Promise<void>;
    }) | null;

    if (!video || !sinkId || !video.setSinkId) {
      return;
    }

    void video.setSinkId(sinkId).catch(() => undefined);
  }, [sinkId]);

  return (
    <div className={cn('relative overflow-hidden rounded-3xl bg-zinc-950', className)}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full min-h-56 flex-col items-center justify-center gap-3 text-zinc-500">
          <CameraOff className="h-8 w-8" />
          <span>{placeholder ?? 'No video yet'}</span>
        </div>
      )}
      <div className="absolute bottom-3 left-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
        {label}
      </div>
    </div>
  );
}

