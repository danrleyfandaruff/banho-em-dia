import type { Appointment } from './agenda-types';

export function canRenewPlan(
  session: Pick<Appointment, 'planType' | 'sessionNumber' | 'totalSessions' | 'status' | 'renewal'> | undefined,
  scheduledCount: number,
): boolean {
  return Boolean(session && session.planType !== 'single' && !session.renewal
    && session.sessionNumber === session.totalSessions
    && session.status === 'completed' && scheduledCount === 0);
}
