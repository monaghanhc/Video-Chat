export type AuditEvent =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.signup.success'
  | 'auth.signup.failure'
  | 'auth.guest.created'
  | 'auth.logout'
  | 'auth.refresh.failure'
  | 'room.create'
  | 'room.join.success'
  | 'room.join.failure'
  | 'room.join.rate_limited'
  | 'room.block'
  | 'room.report'
  | 'socket.unauthorized'
  | 'socket.rate_limited';

export function auditLog(event: AuditEvent, details: Record<string, string | number | boolean> = {}): void {
  const payload = {
    event,
    at: new Date().toISOString(),
    ...details
  };

  console.info('[audit]', JSON.stringify(payload));
}
