import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ensureAccessToken } from '../lib/authSession';
import {
  deriveConnectionStatus,
  participantLeftMessage,
  shouldUseDataChannel
} from '../lib/callState';
import {
  getIceServers,
  hasTurnServer,
  playIncomingCallTone,
  type VideoQualityTier,
  videoQualityProfiles
} from '../lib/webrtc';

type DeskCallSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type Role = 'creator' | 'joiner' | null;
type RemoteStreams = Record<string, MediaStream>;
type RemoteParticipant = { id: string; stream: MediaStream | null };
const qualityOrder: VideoQualityTier[] = ['survival', 'low', 'balanced', 'high'];

interface UseDeskCallOptions {
  signalingServerUrl: string;
  localStream: MediaStream | null;
}

interface UseDeskCallResult {
  roomId: RoomId | null;
  selfId: string | null;
  participants: ParticipantPresence[];
  remoteParticipants: RemoteParticipant[];
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
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const roleRef = useRef<Role>(null);
  const roomIdRef = useRef<RoomId | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const reconnectAttemptedRef = useRef<Set<string>>(new Set());
  const connectionTimeoutRef = useRef<number | null>(null);
  const statsIntervalRef = useRef<number | null>(null);
  const healthySamplesRef = useRef(0);
  const currentQualityTierRef = useRef<VideoQualityTier>('balanced');
  const useDataChannelRef = useRef(false);
  const participantsRef = useRef<ParticipantPresence[]>([]);

  const [roomId, setRoomId] = useState<RoomId | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantPresence[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<RemoteStreams>({});
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

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  const remoteParticipants = useMemo<RemoteParticipant[]>(() => {
    if (!selfId) {
      return [];
    }

    return participants
      .filter((participant) => participant.id !== selfId)
      .map((participant) => ({
        id: participant.id,
        stream: remoteStreams[participant.id] ?? null
      }));
  }, [participants, remoteStreams, selfId]);

  const updateCallStatus = useCallback((nextParticipants: ParticipantPresence[]) => {
    const activeSelfId = selfIdRef.current;
    if (!activeSelfId) {
      return;
    }

    const peerConnections = peerConnectionsRef.current;
    const connectedCount = [...peerConnections.values()].filter(
      (peerConnection) => peerConnection.connectionState === 'connected'
    ).length;
    const connectingCount = [...peerConnections.values()].filter((peerConnection) =>
      ['new', 'connecting'].includes(peerConnection.connectionState)
    ).length;

    const nextStatus = deriveConnectionStatus(
      nextParticipants,
      activeSelfId,
      connectedCount,
      connectingCount
    );
    setStatus(nextStatus);

    if (nextStatus === 'connected') {
      setError(null);
    }
  }, []);

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

  const flushPendingIceCandidates = useCallback(async (peerId: string) => {
    const peerConnection = peerConnectionsRef.current.get(peerId);
    const pendingCandidates = pendingIceCandidatesRef.current.get(peerId) ?? [];

    if (!peerConnection?.remoteDescription || pendingCandidates.length === 0) {
      return;
    }

    for (const candidate of pendingCandidates) {
      await peerConnection.addIceCandidate(candidate);
    }

    pendingIceCandidatesRef.current.delete(peerId);
  }, []);

  const closePeerConnection = useCallback((peerId?: string) => {
    const closeOne = (targetPeerId: string) => {
      const peerConnection = peerConnectionsRef.current.get(targetPeerId);
      peerConnection?.close();
      peerConnectionsRef.current.delete(targetPeerId);
      pendingIceCandidatesRef.current.delete(targetPeerId);
      reconnectAttemptedRef.current.delete(targetPeerId);
      setRemoteStreams((current) => {
        if (!(targetPeerId in current)) {
          return current;
        }

        const { [targetPeerId]: removedStream, ...rest } = current;
        void removedStream;
        return rest;
      });
    };

    if (peerId) {
      closeOne(peerId);
      return;
    }

    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    for (const targetPeerId of [...peerConnectionsRef.current.keys()]) {
      closeOne(targetPeerId);
    }
    pendingIceCandidatesRef.current.clear();
    reconnectAttemptedRef.current.clear();
    if (connectionTimeoutRef.current) {
      window.clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (statsIntervalRef.current) {
      window.clearInterval(statsIntervalRef.current);
      statsIntervalRef.current = null;
    }
    setDataChannelReady(false);
    healthySamplesRef.current = 0;
    currentQualityTierRef.current = 'balanced';
    setQualityTier('balanced');
    setNetworkSummary('Waiting for media path');
  }, []);

  const applyVideoQualityTier = useCallback(async (tier: VideoQualityTier) => {
    const peerConnections = peerConnectionsRef.current;
    let applied = false;

    for (const peerConnection of peerConnections.values()) {
      const sender = peerConnection
        .getSenders()
        .find((candidate) => candidate.track?.kind === 'video');

      if (!sender) {
        continue;
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
        applied = true;
      } catch {
        // Some browsers expose only a subset of sender controls.
      }
    }

    if (applied) {
      currentQualityTierRef.current = tier;
      setQualityTier(tier);
    }
  }, []);

  const startStatsMonitor = useCallback(() => {
    if (statsIntervalRef.current) {
      window.clearInterval(statsIntervalRef.current);
    }

    statsIntervalRef.current = window.setInterval(() => {
      const peerConnections = [...peerConnectionsRef.current.values()];
      const connectedPeer = peerConnections.find(
        (peerConnection) => peerConnection.connectionState === 'connected'
      );

      if (!connectedPeer) {
        return;
      }

      void connectedPeer.getStats().then(async (stats) => {
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
        const connectedCount = peerConnections.filter(
          (peerConnection) => peerConnection.connectionState === 'connected'
        ).length;
        setNetworkSummary(
          `${videoQualityProfiles[currentQualityTierRef.current].label} · ${connectedCount}/${peerConnections.length} links · ${bitrateLabel} · ${rttLabel}`
        );
      });
    }, 4000);
  }, [applyVideoQualityTier]);

  const armConnectionTimeout = useCallback(() => {
    if (connectionTimeoutRef.current) {
      window.clearTimeout(connectionTimeoutRef.current);
    }

    connectionTimeoutRef.current = window.setTimeout(() => {
      const activeSelfId = selfIdRef.current;
      if (!activeSelfId) {
        return;
      }

      const expectedPeerCount = participantsRef.current.filter(
        (participant) => participant.id !== activeSelfId
      ).length;
      const connectedCount = [...peerConnectionsRef.current.values()].filter(
        (peerConnection) => peerConnection.connectionState === 'connected'
      ).length;

      if (expectedPeerCount === 0 || connectedCount >= expectedPeerCount) {
        return;
      }

      setStatus('failed');
      setError(
        hasTurnServer()
          ? 'DeskCall could not connect to every participant. Retry the call.'
          : 'DeskCall could not establish media paths to every participant. This network likely needs TURN relay support.'
      );
    }, 18_000);
  }, []);

  const createPeerConnection = useCallback(
    (peerId: string, initiator: boolean): RTCPeerConnection => {
      closePeerConnection(peerId);

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
          targetId: peerId,
          candidate: event.candidate.toJSON()
        });
      };

      peerConnection.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) {
          return;
        }

        setRemoteStreams((current) => ({
          ...current,
          [peerId]: stream
        }));
      };

      peerConnection.onconnectionstatechange = () => {
        updateCallStatus(participantsRef.current);

        switch (peerConnection.connectionState) {
          case 'connected':
            if (connectionTimeoutRef.current) {
              window.clearTimeout(connectionTimeoutRef.current);
              connectionTimeoutRef.current = null;
            }
            setError(null);
            void applyVideoQualityTier(currentQualityTierRef.current);
            startStatsMonitor();
            break;
          case 'disconnected':
            setStatus('disconnected');
            setError('A participant connection dropped. DeskCall is trying to recover.');
            break;
          case 'failed':
            setStatus('failed');
            setError('A participant connection failed. Retry if media does not return.');
            break;
          case 'closed':
            updateCallStatus(participantsRef.current);
            break;
        }
      };

      peerConnection.oniceconnectionstatechange = () => {
        if (
          peerConnection.iceConnectionState === 'failed' &&
          initiator &&
          !reconnectAttemptedRef.current.has(peerId)
        ) {
          reconnectAttemptedRef.current.add(peerId);
          peerConnection.restartIce();
        }
      };

      if (useDataChannelRef.current) {
        if (initiator) {
          setupDataChannel(peerConnection.createDataChannel('deskcall-chat'));
        } else {
          peerConnection.ondatachannel = (event) => setupDataChannel(event.channel);
        }
      }

      peerConnectionsRef.current.set(peerId, peerConnection);
      return peerConnection;
    },
    [applyVideoQualityTier, closePeerConnection, setupDataChannel, startStatsMonitor, updateCallStatus]
  );

  const sendOffer = useCallback(
    async (targetId: string) => {
      if (!roomIdRef.current || targetId === selfIdRef.current) {
        return;
      }

      const peerConnection = createPeerConnection(targetId, true);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socketRef.current?.emit('signal:offer', {
        roomId: roomIdRef.current,
        targetId,
        description: offer
      });
      setStatus('connecting');
      armConnectionTimeout();
    },
    [armConnectionTimeout, createPeerConnection]
  );

  const syncDataChannelMode = useCallback((nextParticipants: ParticipantPresence[]) => {
    const enableDataChannel = shouldUseDataChannel(nextParticipants.length);
    if (enableDataChannel === useDataChannelRef.current) {
      return;
    }

    useDataChannelRef.current = enableDataChannel;
    if (!enableDataChannel) {
      dataChannelRef.current?.close();
      dataChannelRef.current = null;
      setDataChannelReady(false);
    }
  }, []);

  const retryConnection = useCallback(async () => {
    if (!roomIdRef.current || !selfIdRef.current) {
      return;
    }

    setError(null);
    const peerIds = participants
      .map((participant) => participant.id)
      .filter((participantId) => participantId !== selfIdRef.current);

    await Promise.all(peerIds.map((peerId) => sendOffer(peerId)));
  }, [participants, sendOffer]);

  const leaveRoom = useCallback(() => {
    if (roomIdRef.current) {
      socketRef.current?.emit('room:leave', { roomId: roomIdRef.current });
    }

    closePeerConnection();
    roleRef.current = null;
    roomIdRef.current = null;
    useDataChannelRef.current = false;
    setRoomId(null);
    setParticipants([]);
    setMessages([]);
    setStatus('idle');
    setError(null);
  }, [closePeerConnection]);

  useEffect(() => {
    let cancelled = false;
    let socket: DeskCallSocket | null = null;

    async function connectSignaling() {
      try {
        const token = await ensureAccessToken(signalingServerUrl);
        if (cancelled) {
          return;
        }

        socket = io(signalingServerUrl, {
          transports: ['websocket'],
          auth: { token },
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 500,
          reconnectionDelayMax: 5000
        });

        socketRef.current = socket;
        bindSocketEvents(socket);
      } catch {
        if (!cancelled) {
          setSignalingConnected(false);
          setError('Unable to authenticate with the signaling server.');
        }
      }
    }

    function bindSocketEvents(activeSocket: DeskCallSocket) {
      activeSocket.on('connect', () => {
      const connectedId = activeSocket.id ?? null;
      selfIdRef.current = connectedId;
      setSelfId(connectedId);
      setSignalingConnected(true);
      setError(null);

      if (roomIdRef.current) {
        closePeerConnection();
        setStatus('connecting');
        activeSocket.emit('room:join', { roomId: roomIdRef.current });
      }
    });

      activeSocket.on('disconnect', () => {
      setSignalingConnected(false);
      if (roomIdRef.current) {
        setStatus('disconnected');
        setError('Lost contact with the signaling server. Reconnecting…');
      }
    });

      activeSocket.on('connect_error', () => {
      setSignalingConnected(false);
      setError('Unable to reach the signaling server.');
    });

      activeSocket.on('room:created', (payload) => {
      roleRef.current = 'creator';
      roomIdRef.current = payload.roomId;
      setRoomId(payload.roomId);
      setParticipants(payload.participants);
      syncDataChannelMode(payload.participants);
      setStatus('waiting');
    });

      activeSocket.on('room:joined', (payload) => {
      if (!roomIdRef.current) {
        roleRef.current = 'joiner';
      }

      roomIdRef.current = payload.roomId;
      setRoomId(payload.roomId);
      setParticipants(payload.participants);
      syncDataChannelMode(payload.participants);
      updateCallStatus(payload.participants);
    });

      activeSocket.on('room:error', (payload: RoomErrorPayload) => {
      setError(payload.message);
      if (payload.code === 'ROOM_NOT_FOUND' || payload.code === 'INVALID_ROOM') {
        roleRef.current = null;
        roomIdRef.current = null;
        setRoomId(null);
        setParticipants([]);
        setStatus('idle');
      }
    });

      activeSocket.on('room:participant-joined', (payload) => {
      setParticipants(payload.participants);
      syncDataChannelMode(payload.participants);
      updateCallStatus(payload.participants);
      void playIncomingCallTone().catch(() => undefined);

      if (payload.participant.id !== selfIdRef.current) {
        void sendOffer(payload.participant.id);
      }
    });

      activeSocket.on('room:participant-left', (payload) => {
      setParticipants(payload.participants);
      syncDataChannelMode(payload.participants);
      closePeerConnection(payload.participantId);
      updateCallStatus(payload.participants);

      const leftMessage = participantLeftMessage(payload.participants.length);
      if (leftMessage) {
        setError(leftMessage);
        setStatus('waiting');
      } else {
        setError(null);
      }
    });

      activeSocket.on('signal:offer', async ({ fromId, targetId, description }) => {
      if (!fromId || (targetId && targetId !== selfIdRef.current)) {
        return;
      }

      try {
        void playIncomingCallTone().catch(() => undefined);
        const peerConnection = createPeerConnection(fromId, false);
        await peerConnection.setRemoteDescription(description);
        await flushPendingIceCandidates(fromId);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        armConnectionTimeout();

        if (roomIdRef.current) {
          activeSocket.emit('signal:answer', {
            roomId: roomIdRef.current,
            targetId: fromId,
            description: answer
          });
        }
      } catch {
        setStatus('failed');
        setError('Could not answer an incoming media offer.');
      }
    });

      activeSocket.on('signal:answer', async ({ fromId, targetId, description }) => {
      if (!fromId || (targetId && targetId !== selfIdRef.current)) {
        return;
      }

      try {
        const peerConnection = peerConnectionsRef.current.get(fromId);
        await peerConnection?.setRemoteDescription(description);
        await flushPendingIceCandidates(fromId);
      } catch {
        setStatus('failed');
        setError('Could not finish a WebRTC handshake.');
      }
    });

      activeSocket.on('signal:ice-candidate', async ({ fromId, targetId, candidate }) => {
      if (!fromId || (targetId && targetId !== selfIdRef.current)) {
        return;
      }

      const peerConnection = peerConnectionsRef.current.get(fromId);

      if (!peerConnection?.remoteDescription) {
        const pending = pendingIceCandidatesRef.current.get(fromId) ?? [];
        pending.push(candidate);
        pendingIceCandidatesRef.current.set(fromId, pending);
        return;
      }

      try {
        await peerConnection.addIceCandidate(candidate);
      } catch {
        setError('A network candidate could not be applied.');
      }
    });

      activeSocket.on('chat:message', (payload: ChatMessagePayload) => {
      if (payload.roomId !== roomIdRef.current || payload.senderId === selfIdRef.current) {
        return;
      }

      setMessages((current) => [
        ...current,
        {
          id: payload.id,
          author: 'peer',
          senderId: payload.senderId,
          body: payload.body,
          sentAt: payload.sentAt
        }
      ]);
    });
    }

    void connectSignaling();

    return () => {
      cancelled = true;
      socket?.disconnect();
      socketRef.current = null;
      closePeerConnection();
    };
  }, [
    armConnectionTimeout,
    closePeerConnection,
    createPeerConnection,
    flushPendingIceCandidates,
    sendOffer,
    signalingServerUrl,
    syncDataChannelMode,
    updateCallStatus
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

    if (useDataChannelRef.current && dataChannel?.readyState === 'open') {
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
    const cameraTrack = cameraTrackRef.current;

    screenTrackRef.current?.stop();
    screenTrackRef.current = null;

    for (const peerConnection of peerConnectionsRef.current.values()) {
      const sender = peerConnection
        .getSenders()
        .find((candidate) => candidate.track?.kind === 'video');

      if (sender && cameraTrack) {
        await sender.replaceTrack(cameraTrack);
      }
    }

    setIsScreenSharing(false);
  }, []);

  const startScreenShare = useCallback(async () => {
    if (peerConnectionsRef.current.size === 0) {
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

      for (const peerConnection of peerConnectionsRef.current.values()) {
        const sender = peerConnection
          .getSenders()
          .find((candidate) => candidate.track?.kind === 'video');

        if (sender) {
          await sender.replaceTrack(screenTrack);
        }
      }

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
    selfId,
    participants,
    remoteParticipants,
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
