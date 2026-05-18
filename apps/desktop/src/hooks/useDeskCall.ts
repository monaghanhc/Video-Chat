import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  type ChatMessage,
  type ClientToServerEvents,
  type ConnectionStatus,
  type ParticipantPresence,
  type RoomErrorPayload,
  type RoomId,
  type ServerToClientEvents
} from '@deskcall/shared';
import { getIceServers, playIncomingCallTone } from '../lib/webrtc';

type DeskCallSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type Role = 'creator' | 'joiner' | null;

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

  const [roomId, setRoomId] = useState<RoomId | null>(null);
  const [participants, setParticipants] = useState<ParticipantPresence[]>([]);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [signalingConnected, setSignalingConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [dataChannelReady, setDataChannelReady] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

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
    setDataChannelReady(false);
    setRemoteStream(null);
    reconnectAttemptedRef.current = false;
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
            reconnectAttemptedRef.current = false;
            setError(null);
            setStatus('connected');
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
    [closePeerConnection, setupDataChannel]
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
  }, [createPeerConnection]);

  const retryConnection = useCallback(async () => {
    if (!roomIdRef.current || roleRef.current !== 'creator') {
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

    return () => {
      socket.disconnect();
      socketRef.current = null;
      closePeerConnection();
    };
  }, [closePeerConnection, createPeerConnection, flushPendingIceCandidates, sendOffer, signalingServerUrl]);

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

    if (!trimmedBody || dataChannelRef.current?.readyState !== 'open') {
      return;
    }

    const sentAt = Date.now();
    dataChannelRef.current.send(JSON.stringify({ body: trimmedBody, sentAt }));
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
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
    createRoom,
    joinRoom,
    leaveRoom,
    retryConnection,
    sendMessage,
    startScreenShare,
    stopScreenShare
  };
}

