import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  type ChatMessagePayload,
  type ChatMessage,
  type ClientToServerEvents,
  type ConnectionStatus,
  type ParticipantPresence,
  type RoomErrorPayload,
  type RoomId,
  type ServerToClientEvents
} from '@deskcall/shared';
import {
  getIceServers,
  hasTurnServer,
  playIncomingCallTone,
  type VideoQualityTier,
  videoQualityProfiles
} from '../lib/webrtc';

type DeskCallSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type Role = 'creator' | 'joiner' | null;
const qualityOrder: VideoQualityTier[] = ['survival', 'low', 'balanced', 'high'];

interface UseDeskCallOptions {
  signalingServerUrl: string;
  localStream: MediaStream | null;
}

interface UseDeskCallResult {
  roomId: RoomId | null;
  participants: ParticipantPresence[];
  remoteStream: MediaStream | null;
  status: ConnectionStatus;
  signalingConnected: boolean;
  error: string | null;
  messages: ChatMessage[];
  dataChannelReady: boolean;
  isScreenSharing: boolean;
  qualityTier: VideoQualityTier;
  networkSummary: string;
  createRoom: () => void;
  joinRoom: (roomId: string) => void;
  leaveRoom: () => void;
  retryConnection: () => Promise<void>;
  sendMessage: (body: string) => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => Promise<void>;
}

export function useDeskCall({
  signalingServerUrl,
  localStream
}: UseDeskCallOptions): UseDeskCallResult {
  const socketRef = useRef<DeskCallSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const roleRef = useRef<Role>(null);
  const roomIdRef = useRef<RoomId | null>(null);
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const reconnectAttemptedRef = useRef(false);
  const connectionTimeoutRef = useRef<number | null>(null);
  const statsIntervalRef = useRef<number | null>(null);
  const healthySamplesRef = useRef(0);
  const currentQualityTierRef = useRef<VideoQualityTier>('balanced');

  const [roomId, setRoomId] = useState<RoomId | null>(null);
  const [participants, setParticipants] = useState<ParticipantPresence[]>([]);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [signalingConnected, setSignalingConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [dataChannelReady, setDataChannelReady] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [qualityTier, setQualityTier] = useState<VideoQualityTier>('balanced');
  const [networkSummary, setNetworkSummary] = useState('Waiting for media path');

  useEffect(() => {
    localStreamRef.current = localStream;
    cameraTrackRef.current = localStream?.getVideoTracks()[0] ?? null;
  }, [localStream]);

  const setupDataChannel = useCallback((channel: RTCDataChannel) => {
    dataChannelRef.current = channel;
    channel.onopen = () => setDataChannelReady(true);
    channel.onclose = () => setDataChannelReady(false);
    channel.onerror = () => setError('Chat channel closed unexpectedly.');
    channel.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string) as { body: string; sentAt: number };
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            author: 'peer',
            body: payload.body,
            sentAt: payload.sentAt
          }
        ]);
      } catch {
        setError('Received a malformed chat message.');
      }
    };
  }, []);

  const flushPendingIceCandidates = useCallback(async () => {
    const peerConnection = peerConnectionRef.current;

    if (!peerConnection?.remoteDescription) {
      return;
    }

    for (const candidate of pendingIceCandidatesRef.current) {
      await peerConnection.addIceCandidate(candidate);
    }

    pendingIceCandidatesRef.current = [];
  }, []);

  const closePeerConnection = useCallback(() => {
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    pendingIceCandidatesRef.current = [];
    if (connectionTimeoutRef.current) {
      window.clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (statsIntervalRef.current) {
      window.clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    setDataChannelReady(false);
    setRemoteStream(null);
    reconnectAttemptedRef.current = false;
    healthySamplesRef.current = 0;
    currentQualityTierRef.current = 'balanced';
    setQualityTier('balanced');
    setNetworkSummary('Waiting for media path');
  }, []);

  const applyVideoQualityTier = useCallback(async (tier: VideoQualityTier) => {
    const peerConnection = peerConnectionRef.current;
    const sender = peerConnection?.getSenders().find((candidate) => candidate.track?.kind === 'video');

    if (!sender) {
      return;
    }

    try {
      const parameters = sender.getParameters();
      if (parameters.encodings.length === 0) {
        parameters.encodings = [{}];
      }

      parameters.encodings = parameters.encodings.map((encoding) => ({
        ...encoding,
        maxBitrate: videoQualityProfiles[tier].maxBitrate,
        scaleResolutionDownBy: videoQualityProfiles[tier].scaleResolutionDownBy
      }));

      await sender.setParameters(parameters);
      currentQualityTierRef.current = tier;
      setQualityTier(tier);
    } catch {
      // Some browsers expose only a subset of sender controls. Let codec adaptation continue.
    }
  }, []);

  const startStatsMonitor = useCallback(() => {
    if (statsIntervalRef.current) {
      window.clearInterval(statsIntervalRef.current);
    }

    statsIntervalRef.current = window.setInterval(() => {
      const peerConnection = peerConnectionRef.current;
      if (!peerConnection || peerConnection.connectionState !== 'connected') {
        return;
      }

      void peerConnection.getStats().then(async (stats) => {
        let availableOutgoingBitrate: number | undefined;
        let roundTripTime: number | undefined;

        stats.forEach((report) => {
          if (
            report.type === 'candidate-pair' &&
            report.state === 'succeeded' &&
            report.nominated
          ) {
            availableOutgoingBitrate = report.availableOutgoingBitrate as number | undefined;
          }

          if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
            roundTripTime = report.roundTripTime as number | undefined;
          }
        });

        const currentIndex = qualityOrder.indexOf(currentQualityTierRef.current);
        let targetTier: VideoQualityTier = 'high';

        if (
          (availableOutgoingBitrate !== undefined && availableOutgoingBitrate < 300_000) ||
          (roundTripTime !== undefined && roundTripTime > 0.65)
        ) {
          targetTier = 'survival';
        } else if (
          (availableOutgoingBitrate !== undefined && availableOutgoingBitrate < 650_000) ||
          (roundTripTime !== undefined && roundTripTime > 0.4)
        ) {
          targetTier = 'low';
        } else if (
          (availableOutgoingBitrate !== undefined && availableOutgoingBitrate < 1_100_000) ||
          (roundTripTime !== undefined && roundTripTime > 0.25)
        ) {
          targetTier = 'balanced';
        }

        const targetIndex = qualityOrder.indexOf(targetTier);

        if (targetIndex < currentIndex) {
          healthySamplesRef.current = 0;
          await applyVideoQualityTier(targetTier);
        } else if (targetIndex > currentIndex) {
          healthySamplesRef.current += 1;
          if (healthySamplesRef.current >= 3) {
            healthySamplesRef.current = 0;
            await applyVideoQualityTier(qualityOrder[Math.min(currentIndex + 1, qualityOrder.length - 1)]!);
          }
        } else {
          healthySamplesRef.current = 0;
        }

        const bitrateLabel =
          availableOutgoingBitrate === undefined
            ? 'estimating bitrate'
            : `${Math.round(availableOutgoingBitrate / 1000)} kbps`;
        const rttLabel =
          roundTripTime === undefined ? 'RTT pending' : `${Math.round(roundTripTime * 1000)} ms RTT`;
        setNetworkSummary(`${videoQualityProfiles[currentQualityTierRef.current].label} · ${bitrateLabel} · ${rttLabel}`);
      });
    }, 4000);
  }, [applyVideoQualityTier]);

  const armConnectionTimeout = useCallback(() => {
    if (connectionTimeoutRef.current) {
      window.clearTimeout(connectionTimeoutRef.current);
    }

    connectionTimeoutRef.current = window.setTimeout(() => {
      if (peerConnectionRef.current?.connectionState === 'connected') {
        return;
      }

      setStatus('failed');
      setError(
        hasTurnServer()
          ? 'DeskCall could not establish the media path. Retry the call.'
          : 'DeskCall could not establish a direct media path. This network likely needs TURN relay support.'
      );
    }, 18_000);
  }, []);

  const createPeerConnection = useCallback(
    (initiator: boolean): RTCPeerConnection => {
      closePeerConnection();

      const peerConnection = new RTCPeerConnection({
        iceServers: getIceServers()
      });

      localStreamRef.current?.getTracks().forEach((track) => {
        peerConnection.addTrack(track, localStreamRef.current!);
      });

      peerConnection.onicecandidate = (event) => {
        if (!event.candidate || !roomIdRef.current) {
          return;
        }

        socketRef.current?.emit('signal:ice-candidate', {
          roomId: roomIdRef.current,
          candidate: event.candidate.toJSON()
        });
      };

      peerConnection.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream) {
          setRemoteStream(stream);
        }
      };

      peerConnection.onconnectionstatechange = () => {
        switch (peerConnection.connectionState) {
          case 'new':
          case 'connecting':
            setStatus('connecting');
            break;
          case 'connected':
            if (connectionTimeoutRef.current) {
              window.clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            reconnectAttemptedRef.current = false;
            setError(null);
            setStatus('connected');
            void applyVideoQualityTier(currentQualityTierRef.current);
            startStatsMonitor();
            break;
          case 'disconnected':
            setStatus('disconnected');
            setError('The peer connection was interrupted. DeskCall is trying to recover.');
            break;
          case 'failed':
            setStatus('failed');
            setError('The peer connection failed. A retry may be needed.');
            break;
          case 'closed':
            setStatus('disconnected');
            break;
        }
      };

      peerConnection.oniceconnectionstatechange = () => {
        if (
          peerConnection.iceConnectionState === 'failed' &&
          initiator &&
          !reconnectAttemptedRef.current
        ) {
          reconnectAttemptedRef.current = true;
          peerConnection.restartIce();
        }
      };

      if (initiator) {
        setupDataChannel(peerConnection.createDataChannel('deskcall-chat'));
      } else {
        peerConnection.ondatachannel = (event) => setupDataChannel(event.channel);
      }

      peerConnectionRef.current = peerConnection;
      return peerConnection;
    },
    [applyVideoQualityTier, closePeerConnection, setupDataChannel, startStatsMonitor]
  );

  const sendOffer = useCallback(async () => {
    if (!roomIdRef.current) {
      return;
    }

    const peerConnection = createPeerConnection(true);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socketRef.current?.emit('signal:offer', {
      roomId: roomIdRef.current,
      description: offer
    });
    setStatus('connecting');
    armConnectionTimeout();
  }, [armConnectionTimeout, createPeerConnection]);

  const retryConnection = useCallback(async () => {
    if (!roomIdRef.current) {
      return;
    }

    setError(null);
    await sendOffer();
  }, [sendOffer]);

  const leaveRoom = useCallback(() => {
    if (roomIdRef.current) {
      socketRef.current?.emit('room:leave', { roomId: roomIdRef.current });
    }

    closePeerConnection();
    roleRef.current = null;
    roomIdRef.current = null;
    setRoomId(null);
    setParticipants([]);
    setMessages([]);
    setStatus('idle');
    setError(null);
  }, [closePeerConnection]);

  useEffect(() => {
    const socket: DeskCallSocket = io(signalingServerUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setSignalingConnected(true);
      setError(null);

      if (roomIdRef.current) {
        socket.emit('room:join', { roomId: roomIdRef.current });
      }
    });

    socket.on('disconnect', () => {
      setSignalingConnected(false);
      if (roomIdRef.current) {
        setStatus('disconnected');
        setError('Lost contact with the signaling server. Reconnecting…');
      }
    });

    socket.on('connect_error', () => {
      setSignalingConnected(false);
      setError('Unable to reach the signaling server.');
    });

    socket.on('room:created', (payload) => {
      roleRef.current = 'creator';
      roomIdRef.current = payload.roomId;
      setRoomId(payload.roomId);
      setParticipants(payload.participants);
      setStatus('waiting');
    });

    socket.on('room:joined', (payload) => {
      if (!roomIdRef.current) {
        roleRef.current = 'joiner';
      }

      roomIdRef.current = payload.roomId;
      setRoomId(payload.roomId);
      setParticipants(payload.participants);
      setStatus(payload.participants.length > 1 ? 'connecting' : 'waiting');
    });

    socket.on('room:error', (payload: RoomErrorPayload) => {
      setError(payload.message);
      if (payload.code === 'ROOM_NOT_FOUND' || payload.code === 'INVALID_ROOM') {
        roleRef.current = null;
        roomIdRef.current = null;
        setRoomId(null);
        setParticipants([]);
        setStatus('idle');
      }
    });

    socket.on('room:participant-joined', (payload) => {
      setParticipants(payload.participants);
      setStatus('connecting');
      void playIncomingCallTone().catch(() => undefined);
      void sendOffer();
    });

    socket.on('room:participant-left', (payload) => {
      setParticipants(payload.participants);
      closePeerConnection();
      setStatus('waiting');
      setError('The other participant left the room.');
    });

    socket.on('signal:offer', async ({ description }) => {
      try {
        void playIncomingCallTone().catch(() => undefined);
        const peerConnection = createPeerConnection(false);
        await peerConnection.setRemoteDescription(description);
        await flushPendingIceCandidates();
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        armConnectionTimeout();

        if (roomIdRef.current) {
          socket.emit('signal:answer', {
            roomId: roomIdRef.current,
            description: answer
          });
        }
      } catch {
        setStatus('failed');
        setError('Could not answer the incoming call.');
      }
    });

    socket.on('signal:answer', async ({ description }) => {
      try {
        await peerConnectionRef.current?.setRemoteDescription(description);
        await flushPendingIceCandidates();
      } catch {
        setStatus('failed');
        setError('Could not finish the WebRTC handshake.');
      }
    });

    socket.on('signal:ice-candidate', async ({ candidate }) => {
      const peerConnection = peerConnectionRef.current;

      if (!peerConnection?.remoteDescription) {
        pendingIceCandidatesRef.current.push(candidate);
        return;
      }

      try {
        await peerConnection.addIceCandidate(candidate);
      } catch {
        setError('A network candidate could not be applied.');
      }
    });

    socket.on('chat:message', (payload: ChatMessagePayload) => {
      if (payload.roomId !== roomIdRef.current) {
        return;
      }

      setMessages((current) => [
        ...current,
        {
          id: payload.id,
          author: 'peer',
          body: payload.body,
          sentAt: payload.sentAt
        }
      ]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      closePeerConnection();
    };
  }, [
    armConnectionTimeout,
    closePeerConnection,
    createPeerConnection,
    flushPendingIceCandidates,
    sendOffer,
    signalingServerUrl
  ]);

  const createRoom = useCallback(() => {
    setError(null);
    socketRef.current?.emit('room:create');
  }, []);

  const joinRoom = useCallback((nextRoomId: string) => {
    setError(null);
    socketRef.current?.emit('room:join', { roomId: nextRoomId.trim().toUpperCase() as RoomId });
  }, []);

  const sendMessage = useCallback((body: string) => {
    const trimmedBody = body.trim();
    const activeRoomId = roomIdRef.current;

    if (!trimmedBody || !activeRoomId) {
      return;
    }

    const id = crypto.randomUUID();
    const sentAt = Date.now();
    const dataChannel = dataChannelRef.current;

    if (dataChannel?.readyState === 'open') {
      dataChannel.send(JSON.stringify({ body: trimmedBody, sentAt }));
    } else {
      socketRef.current?.emit('chat:message', {
        roomId: activeRoomId,
        id,
        body: trimmedBody,
        sentAt
      });
    }

    setMessages((current) => [
      ...current,
      {
        id,
        author: 'me',
        body: trimmedBody,
        sentAt
      }
    ]);
  }, []);

  const stopScreenShare = useCallback(async () => {
    const peerConnection = peerConnectionRef.current;
    const cameraTrack = cameraTrackRef.current;
    const sender = peerConnection?.getSenders().find((candidate) => candidate.track?.kind === 'video');

    screenTrackRef.current?.stop();
    screenTrackRef.current = null;

    if (sender && cameraTrack) {
      await sender.replaceTrack(cameraTrack);
    }

    setIsScreenSharing(false);
  }, []);

  const startScreenShare = useCallback(async () => {
    const peerConnection = peerConnectionRef.current;
    const sender = peerConnection?.getSenders().find((candidate) => candidate.track?.kind === 'video');

    if (!sender) {
      setError('Start a call before sharing your screen.');
      return;
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });
      const [screenTrack] = screenStream.getVideoTracks();

      if (!screenTrack) {
        return;
      }

      screenTrackRef.current = screenTrack;
      screenTrack.onended = () => {
        void stopScreenShare();
      };

      await sender.replaceTrack(screenTrack);
      setIsScreenSharing(true);
    } catch {
      setError('Screen sharing was cancelled or unavailable.');
    }
  }, [stopScreenShare]);

  useEffect(() => {
    return () => {
      screenTrackRef.current?.stop();
    };
  }, []);

  return {
    roomId,
    participants,
    remoteStream,
    status,
    signalingConnected,
    error,
    messages,
    dataChannelReady,
    isScreenSharing,
    qualityTier,
    networkSummary,
    createRoom,
    joinRoom,
    leaveRoom,
    retryConnection,
    sendMessage,
    startScreenShare,
    stopScreenShare
  };
}
