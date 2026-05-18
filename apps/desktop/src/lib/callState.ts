import type { ConnectionStatus, ParticipantPresence } from '@deskcall/shared';

export function countExpectedPeers(
  participants: ParticipantPresence[],
  selfId: string | null
): number {
  if (!selfId) {
    return 0;
  }

  return participants.filter((participant) => participant.id !== selfId).length;
}

export function deriveConnectionStatus(
  participants: ParticipantPresence[],
  selfId: string | null,
  connectedPeerCount: number,
  connectingPeerCount: number
): ConnectionStatus {
  const expectedPeerCount = countExpectedPeers(participants, selfId);

  if (expectedPeerCount === 0) {
    return 'waiting';
  }

  if (connectedPeerCount >= expectedPeerCount) {
    return 'connected';
  }

  if (connectingPeerCount > 0 || connectedPeerCount > 0) {
    return 'connecting';
  }

  return 'connecting';
}

export function shouldUseDataChannel(participantCount: number): boolean {
  return participantCount === 2;
}

export function participantLeftMessage(remainingCount: number): string | null {
  if (remainingCount <= 1) {
    return 'Everyone else left the room.';
  }

  return null;
}
