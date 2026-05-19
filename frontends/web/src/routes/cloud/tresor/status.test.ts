import { describe, expect, it } from 'vitest';
import { docStatus } from './status';
import type { TresorDoc } from '../state/types';

const base: TresorDoc = { id: 'x', identityId: 'i', title: 't', body: 'b',
  createdAt: 0, updatedAt: 0, recipients: [] };

describe('docStatus', () => {
  it('returns Draft when no recipients', () => {
    expect(docStatus(base).kind).toBe('draft');
  });
  it('returns Sealed when all recipients have null delay', () => {
    expect(docStatus({ ...base, recipients: [{ contactId: 'c', unlockDelayDays: null }] }).kind).toBe('sealed');
  });
  it('reports the closest unfired timer for at-risk docs', () => {
    const s = docStatus({ ...base, recipients: [
      { contactId: 'c1', unlockDelayDays: 90 },
      { contactId: 'c2', unlockDelayDays: 30 },
    ] });
    expect(s).toEqual({ kind: 'at-risk', days: 30 });
  });
  it('reports released when at least one recipient has releasedAt', () => {
    const s = docStatus({ ...base, recipients: [
      { contactId: 'c1', unlockDelayDays: 30, releasedAt: 1 },
      { contactId: 'c2', unlockDelayDays: 90 },
    ] });
    expect(s.kind).toBe('released');
    if (s.kind === 'released') {
      expect(s.contactId).toBe('c1');
    }
  });
});
