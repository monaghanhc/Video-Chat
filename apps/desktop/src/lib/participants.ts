export function shortParticipantLabel(participantId: string): string {
  return `Guest ${participantId.slice(-4).toUpperCase()}`;
}
