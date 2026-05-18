import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Camera,
  CameraOff,
  Download,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  RefreshCcw,
  SendHorizontal,
  Settings2,
  Users
} from 'lucide-react';
import { MAX_ROOM_PARTICIPANTS, type AppSettings, type ConnectionStatus } from '@deskcall/shared';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { Input } from './components/ui/input';
import { InviteCodeInput } from './components/InviteCodeInput';
import { InviteCodeShare } from './components/InviteCodeShare';
import { VideoSurface } from './components/VideoSurface';
import { useDeskCall } from './hooks/useDeskCall';
import { isValidInviteCode } from './lib/inviteCode';
import { shortParticipantLabel } from './lib/participants';
import { normalizePersistedSettings } from './lib/settings';
import { useMediaDevices } from './hooks/useMediaDevices';
import { formatTime } from './lib/utils';
import { getPreferredMediaConstraints, videoQualityProfiles } from './lib/webrtc';

type Screen = 'welcome' | 'precall' | 'call';

const defaultSettings: AppSettings = {
  signalingServerUrl:
    import.meta.env.VITE_SIGNALING_SERVER_URL ?? 'https://deskcall-signaling.onrender.com'
};

const browserSettingsBridge = {
  async getSettings(): Promise<AppSettings> {
    const raw = window.localStorage.getItem('deskcall:settings');
    return raw
      ? normalizePersistedSettings(
          JSON.parse(raw) as Partial<AppSettings>,
          defaultSettings,
          window.location.hostname
        )
      : defaultSettings;
  },
  async setSettings(nextSettings: AppSettings): Promise<AppSettings> {
    window.localStorage.setItem('deskcall:settings', JSON.stringify(nextSettings));
    return nextSettings;
  }
};

const WINDOWS_INSTALLER_URL =
  import.meta.env.VITE_WINDOWS_INSTALLER_URL ??
  'https://github.com/monaghanhc/Video-Chat/releases/latest/download/DeskCall-Setup.exe';

const statusCopy: Record<ConnectionStatus, string> = {
  idle: 'Idle',
  waiting: 'Waiting for people',
  connecting: 'Connecting',
  connected: 'Connected',
  disconnected: 'Disconnected',
  failed: 'Failed'
};

export function App() {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [settingsReady, setSettingsReady] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinIntent, setJoinIntent] = useState<'create' | 'join' | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isRequestingMedia, setIsRequestingMedia] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalledWebApp, setIsInstalledWebApp] = useState(false);

  const { cameras, microphones, speakers, refresh, supportsSpeakerSelection } = useMediaDevices();
  const call = useDeskCall({
    signalingServerUrl: settings.signalingServerUrl,
    localStream
  });
  const settingsBridge = window.deskcall ?? browserSettingsBridge;
  const isDesktopApp = Boolean(window.deskcall);

  useEffect(() => {
    void settingsBridge.getSettings().then((storedSettings) => {
      setSettings(
        normalizePersistedSettings(storedSettings, defaultSettings, window.location.hostname)
      );
      setSettingsReady(true);
    });
  }, [settingsBridge]);

  useEffect(() => {
    const updateInstallState = () => {
      setIsInstalledWebApp(window.matchMedia('(display-mode: standalone)').matches);
    };

    const handleBeforeInstallPrompt = (event: BeforeInstallPromptEvent) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setIsInstalledWebApp(true);
    };

    updateInstallState();
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const persistSettings = useCallback(async (nextSettings: AppSettings) => {
    setSettings(nextSettings);
    await settingsBridge.setSettings(nextSettings);
  }, [settingsBridge]);

  const requestMedia = useCallback(async () => {
    setIsRequestingMedia(true);
    setMediaError(null);

    try {
      localStream?.getTracks().forEach((track) => track.stop());
      const preferredConstraints = getPreferredMediaConstraints();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: settings.preferredMicrophoneId
          ? {
              ...(typeof preferredConstraints.audio === 'object' ? preferredConstraints.audio : {}),
              deviceId: { exact: settings.preferredMicrophoneId }
            }
          : preferredConstraints.audio,
        video: settings.preferredCameraId
          ? {
              ...(typeof preferredConstraints.video === 'object' ? preferredConstraints.video : {}),
              deviceId: { exact: settings.preferredCameraId }
            }
          : preferredConstraints.video
      });

      setLocalStream(stream);
      setIsMicEnabled(true);
      setIsCameraEnabled(true);
      await refresh();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setMediaError('Camera or microphone access was denied.');
      } else if (error instanceof DOMException && error.name === 'NotFoundError') {
        setMediaError('No usable camera or microphone was found.');
      } else {
        setMediaError('Could not open your camera and microphone.');
      }
    } finally {
      setIsRequestingMedia(false);
    }
  }, [localStream, refresh, settings.preferredCameraId, settings.preferredMicrophoneId]);

  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach((track) => track.stop());
    };
  }, [localStream]);

  const toggleMic = useCallback(() => {
    const nextValue = !isMicEnabled;
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = nextValue;
    });
    setIsMicEnabled(nextValue);
  }, [isMicEnabled, localStream]);

  const toggleCamera = useCallback(() => {
    const nextValue = !isCameraEnabled;
    localStream?.getVideoTracks().forEach((track) => {
      track.enabled = nextValue;
    });
    setIsCameraEnabled(nextValue);
  }, [isCameraEnabled, localStream]);

  const beginCreateFlow = useCallback(async () => {
    setJoinIntent('create');
    setScreen('precall');
    await requestMedia();
  }, [requestMedia]);

  const beginJoinFlow = useCallback(async () => {
    if (!isValidInviteCode(joinCode)) {
      return;
    }

    setJoinIntent('join');
    setScreen('precall');
    await requestMedia();
  }, [joinCode, requestMedia]);

  const createRoom = useCallback(() => {
    call.createRoom();
    setScreen('call');
  }, [call]);

  const joinRoom = useCallback(() => {
    call.joinRoom(joinCode);
    setScreen('call');
  }, [call, joinCode]);

  const endCall = useCallback(() => {
    call.leaveRoom();
    setScreen('welcome');
    setJoinIntent(null);
    setChatDraft('');
  }, [call]);

  const canJoinWithCode = isValidInviteCode(joinCode);

  const handleSendMessage = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      call.sendMessage(chatDraft);
      setChatDraft('');
    },
    [call, chatDraft]
  );

  const canChat = Boolean(call.roomId && call.signalingConnected);

  const installWebApp = useCallback(async () => {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }, [installPrompt]);

  if (!settingsReady) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="p-8 text-zinc-300">Loading DeskCall…</Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 text-zinc-100">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-blue-500/20 px-3 py-2 text-sm font-semibold text-blue-200">
                DeskCall
              </div>
              <Badge>{statusCopy[call.status]}</Badge>
              <Badge className={call.signalingConnected ? 'text-emerald-200' : 'text-amber-200'}>
                {call.signalingConnected ? 'Signaling online' : 'Reconnecting'}
              </Badge>
            </div>
            <p className="mt-3 text-sm text-zinc-400">
              Private video calls with room codes, chat, and screen sharing.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isInstalledWebApp ? <Badge className="text-blue-200">Installed app</Badge> : null}
            {installPrompt ? (
              <Button variant="outline" onClick={() => void installWebApp()}>
                <Download className="h-4 w-4" />
                Install app
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setShowSettings((current) => !current)}>
              <Settings2 className="h-4 w-4" />
              Settings
            </Button>
          </div>
        </header>

        {showSettings ? (
          <Card className="grid gap-4 p-5 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="text-zinc-400">Signaling server URL</span>
              <Input
                value={settings.signalingServerUrl}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    signalingServerUrl: event.target.value
                  }))
                }
                onBlur={() => void persistSettings(settings)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-zinc-400">Camera</span>
              <select
                value={settings.preferredCameraId ?? ''}
                onChange={(event) =>
                  void persistSettings({
                    ...settings,
                    preferredCameraId: event.target.value || undefined
                  })
                }
                className="h-12 rounded-2xl border border-zinc-700 bg-zinc-950/70 px-4"
              >
                <option value="">System default</option>
                {cameras.map((camera) => (
                  <option key={camera.deviceId} value={camera.deviceId}>
                    {camera.label || `Camera ${camera.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-zinc-400">Microphone</span>
              <select
                value={settings.preferredMicrophoneId ?? ''}
                onChange={(event) =>
                  void persistSettings({
                    ...settings,
                    preferredMicrophoneId: event.target.value || undefined
                  })
                }
                className="h-12 rounded-2xl border border-zinc-700 bg-zinc-950/70 px-4"
              >
                <option value="">System default</option>
                {microphones.map((microphone) => (
                  <option key={microphone.deviceId} value={microphone.deviceId}>
                    {microphone.label || `Microphone ${microphone.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="text-zinc-400">Speaker</span>
              <select
                value={settings.preferredSpeakerId ?? ''}
                onChange={(event) =>
                  void persistSettings({
                    ...settings,
                    preferredSpeakerId: event.target.value || undefined
                  })
                }
                disabled={!supportsSpeakerSelection}
                className="h-12 rounded-2xl border border-zinc-700 bg-zinc-950/70 px-4 disabled:opacity-50"
              >
                <option value="">
                  {supportsSpeakerSelection ? 'System default' : 'Unavailable on this device'}
                </option>
                {speakers.map((speaker) => (
                  <option key={speaker.deviceId} value={speaker.deviceId}>
                    {speaker.label || `Speaker ${speaker.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
            </label>
          </Card>
        ) : null}

        {screen === 'welcome' ? (
          <section className="grid flex-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="flex flex-col justify-between p-8">
              <div>
                <p className="text-sm uppercase tracking-[0.25em] text-blue-200">Beta release</p>
                <h1 className="mt-5 max-w-2xl text-5xl font-semibold tracking-tight">
                  Call another desk in seconds.
                </h1>
                <p className="mt-5 max-w-xl text-lg leading-8 text-zinc-400">
                  Create a room, share the code, and talk peer-to-peer. No account wall, no paid
                  service dependency, and available as both a desktop app and installable web app.
                </p>
              </div>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button size="lg" onClick={() => void beginCreateFlow()}>
                  Create room
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={() => {
                    if (canJoinWithCode) {
                      void beginJoinFlow();
                      return;
                    }

                    document.getElementById('deskcall-invite-code')?.focus();
                  }}
                >
                  Join room
                </Button>
                {!isDesktopApp ? (
                  <Button size="lg" variant="outline" asChild>
                    <a href={WINDOWS_INSTALLER_URL}>
                      <Download className="h-4 w-4" />
                      Download for Windows
                    </a>
                  </Button>
                ) : null}
              </div>
            </Card>

            <Card className="grid content-start gap-5 p-6">
              <div className="flex items-center gap-3">
                <Users className="h-5 w-5 text-blue-200" />
                <div>
                  <h2 className="text-lg font-semibold">Join by invite code</h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    Paste the six-character code from your host.
                  </p>
                </div>
              </div>

              <InviteCodeInput
                id="deskcall-invite-code"
                value={joinCode}
                onChange={setJoinCode}
                onSubmit={() => void beginJoinFlow()}
                autoFocus
              />

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  size="lg"
                  className="flex-1"
                  onClick={() => void beginJoinFlow()}
                  disabled={!canJoinWithCode}
                >
                  Continue to preview
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="flex-1"
                  onClick={() => void beginCreateFlow()}
                >
                  Create a room instead
                </Button>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-400">
                DeskCall rooms support up to {MAX_ROOM_PARTICIPANTS} people in one call. Hosts copy
                their code from the call screen and share it with guests.
              </div>
            </Card>
          </section>
        ) : null}

        {screen === 'precall' ? (
          <section className="grid flex-1 gap-6 lg:grid-cols-[1fr_0.8fr]">
            <Card className="p-4">
              <VideoSurface
                stream={localStream}
                muted
                label="You"
                placeholder={isRequestingMedia ? 'Requesting camera…' : 'Preview unavailable'}
                className="h-full min-h-[32rem]"
              />
            </Card>

            <Card className="flex flex-col justify-between gap-6 p-6">
              <div>
                <h2 className="text-2xl font-semibold">Check your setup</h2>
                <p className="mt-2 text-zinc-400">
                  Make sure the room sees and hears the version of you that you intend to send.
                </p>
                {mediaError ? (
                  <div className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-100">
                    {mediaError}
                  </div>
                ) : null}

                {joinIntent === 'join' && canJoinWithCode ? (
                  <div className="mt-5 rounded-2xl border border-zinc-700 bg-zinc-950/50 p-4">
                    <p className="text-sm text-zinc-400">You are joining</p>
                    <InviteCodeShare code={joinCode} compact />
                  </div>
                ) : joinIntent === 'create' ? (
                  <p className="mt-5 text-sm text-zinc-400">
                    Your invite code appears right after you create the room so you can copy and share
                    it.
                  </p>
                ) : null}
              </div>

              <div className="grid gap-4">
                <div className="flex gap-3">
                  <Button variant={isMicEnabled ? 'secondary' : 'danger'} onClick={toggleMic}>
                    {isMicEnabled ? <Mic /> : <MicOff />}
                    {isMicEnabled ? 'Mute mic' : 'Unmute mic'}
                  </Button>
                  <Button
                    variant={isCameraEnabled ? 'secondary' : 'danger'}
                    onClick={toggleCamera}
                  >
                    {isCameraEnabled ? <Camera /> : <CameraOff />}
                    {isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
                  </Button>
                </div>
                <div className="grid gap-3">
                  {joinIntent === 'join' ? (
                    <Button
                      size="lg"
                      onClick={joinRoom}
                      disabled={!localStream || !canJoinWithCode || !call.signalingConnected}
                    >
                      Join room {joinCode}
                    </Button>
                  ) : (
                    <Button
                      size="lg"
                      onClick={createRoom}
                      disabled={!localStream || !call.signalingConnected}
                    >
                      Create room and get invite code
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </section>
        ) : null}

        {screen === 'call' ? (
          <section className="grid flex-1 gap-6 xl:grid-cols-[1fr_24rem]">
            <div className="grid gap-6">
              <Card className="grid gap-4 p-4">
                <div className="relative">
                  {call.remoteParticipants.length === 0 ? (
                    <VideoSurface
                      stream={null}
                      label="Waiting for others"
                      placeholder="Share the room code to invite up to three more people"
                      className="h-[32rem]"
                      sinkId={settings.preferredSpeakerId}
                    />
                  ) : call.remoteParticipants.length === 1 ? (
                    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
                      <VideoSurface
                        stream={call.remoteParticipants[0]?.stream ?? null}
                        label={shortParticipantLabel(call.remoteParticipants[0]!.id)}
                        placeholder="Connecting…"
                        className="h-[32rem]"
                        sinkId={settings.preferredSpeakerId}
                      />
                      <VideoSurface
                        stream={localStream}
                        muted
                        label={isCameraEnabled ? 'You' : 'Camera off'}
                        className="h-44 border border-white/10 shadow-2xl lg:h-[32rem]"
                      />
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {call.remoteParticipants.map((participant) => (
                        <VideoSurface
                          key={participant.id}
                          stream={participant.stream}
                          label={shortParticipantLabel(participant.id)}
                          placeholder="Connecting…"
                          className="h-56 sm:h-64"
                          sinkId={settings.preferredSpeakerId}
                        />
                      ))}
                      <VideoSurface
                        stream={localStream}
                        muted
                        label={isCameraEnabled ? 'You' : 'Camera off'}
                        className="h-56 border border-white/10 sm:h-64"
                      />
                    </div>
                  )}
                </div>

                {call.roomId ? <InviteCodeShare code={call.roomId} /> : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Badge>
                    {call.participants.length}/{MAX_ROOM_PARTICIPANTS} present
                  </Badge>
                  {!isMicEnabled ? <Badge className="text-amber-200">Mic muted</Badge> : null}
                  {!isCameraEnabled ? <Badge className="text-amber-200">Camera off</Badge> : null}
                  {call.isScreenSharing ? (
                    <Badge className="text-blue-200">Sharing screen</Badge>
                  ) : null}
                  <Badge>{videoQualityProfiles[call.qualityTier].label}</Badge>
                </div>

              </Card>

              <Card className="grid gap-4 p-5">
                {call.error ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                    <span>{call.error}</span>
                    {call.status === 'failed' ? (
                      <Button variant="outline" onClick={() => void call.retryConnection()}>
                        <RefreshCcw className="h-4 w-4" />
                        Retry
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                <div className="text-sm text-zinc-400">{call.networkSummary}</div>
                <div className="flex flex-wrap gap-3">
                  <Button variant={isMicEnabled ? 'secondary' : 'danger'} onClick={toggleMic}>
                    {isMicEnabled ? <Mic /> : <MicOff />}
                  </Button>
                  <Button
                    variant={isCameraEnabled ? 'secondary' : 'danger'}
                    onClick={toggleCamera}
                  >
                    {isCameraEnabled ? <Camera /> : <CameraOff />}
                  </Button>
                  <Button
                    variant={call.isScreenSharing ? 'default' : 'secondary'}
                    onClick={() =>
                      void (call.isScreenSharing ? call.stopScreenShare() : call.startScreenShare())
                    }
                  >
                    <MonitorUp className="h-4 w-4" />
                    {call.isScreenSharing ? 'Stop sharing' : 'Share screen'}
                  </Button>
                  <Button variant="danger" onClick={endCall}>
                    <PhoneOff className="h-4 w-4" />
                    End call
                  </Button>
                </div>
              </Card>
            </div>

            <Card className="flex min-h-[32rem] flex-col p-5">
              <div>
                <h2 className="text-lg font-semibold">In-call chat</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  {!call.roomId
                    ? 'Join a room to chat.'
                    : call.dataChannelReady
                      ? 'Peer-to-peer chat is live.'
                      : call.signalingConnected
                        ? 'Room chat is live while media connects.'
                        : 'Chat resumes when signaling reconnects.'}
                </p>
              </div>
              <div className="mt-5 flex-1 space-y-3 overflow-y-auto">
                {call.messages.length === 0 ? (
                  <p className="text-sm text-zinc-500">No messages yet.</p>
                ) : (
                  call.messages.map((message) => (
                    <div
                      key={message.id}
                      className={`rounded-2xl p-3 text-sm ${
                        message.author === 'me'
                          ? 'ml-8 bg-blue-500/20'
                          : 'mr-8 bg-white/[0.06]'
                      }`}
                    >
                      <div>{message.body}</div>
                      <div className="mt-2 text-[11px] text-zinc-500">
                        {message.author === 'me'
                          ? 'You'
                          : message.senderId
                            ? shortParticipantLabel(message.senderId)
                            : 'Peer'}{' '}
                        · {formatTime(message.sentAt)}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <form onSubmit={handleSendMessage} className="mt-5 flex gap-2">
                <Input
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                  placeholder="Write a message"
                  disabled={!canChat}
                />
                <Button size="icon" disabled={!canChat || !chatDraft.trim()}>
                  <SendHorizontal className="h-4 w-4" />
                </Button>
              </form>
            </Card>
          </section>
        ) : null}
      </div>
    </main>
  );
}
