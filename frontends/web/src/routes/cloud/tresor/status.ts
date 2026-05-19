import type { TresorDoc } from '../state/types';

export type DocStatus =
  | { kind: 'draft' }
  | { kind: 'sealed' }
  | { kind: 'at-risk'; days: number }
  | { kind: 'released'; contactId: string; releasedAt: number };

export const docStatus = (d: TresorDoc): DocStatus => {
  if (d.recipients.length === 0) {
    return { kind: 'draft' };
  }
  const released = d.recipients.find(r => r.releasedAt !== undefined);
  if (released) {
    return { kind: 'released', contactId: released.contactId, releasedAt: released.releasedAt! };
  }
  const timers = d.recipients
    .filter(r => r.unlockDelayDays !== null && r.releasedAt === undefined)
    .map(r => r.unlockDelayDays as number);
  if (timers.length === 0) {
    return { kind: 'sealed' };
  }
  return { kind: 'at-risk', days: Math.min(...timers) };
};
