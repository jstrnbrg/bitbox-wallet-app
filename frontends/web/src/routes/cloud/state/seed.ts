import type { CloudState } from './types';

const NOW = Date.UTC(2026, 4, 19);
const DAY = 86_400_000;

// Handles of seeded persons whose pairing is treated as verified for demo purposes.
// Kept in sync with the contact entries in buildSeed below.
export const SEEDED_HANDLES: ReadonlySet<string> = new Set([
  'bright-willow-3320', // Alice Reyes
  'amber-falcon-5512', // Bob Martens
  'granite-lynx-2089', // Carol Schmid
  'nimble-fox-7704', // Dave Okonkwo
]);

export function buildSeed(): CloudState {
  return {
    identities: [
      { id: 'i-personal', name: 'Personal', handle: 'silver-otter-4821',
        pubkey: '02f3a9c4...c4a1', avatarSeed: 'silver-otter-4821' },
      { id: 'i-family', name: 'Family Savings', handle: 'copper-finch-9032',
        pubkey: '03ab7710...91e7', avatarSeed: 'copper-finch-9032' },
    ],
    contacts: [
      { id: 'c-family', identityId: 'i-personal', name: 'Family Savings',
        handle: 'copper-finch-9032', pubkey: '03ab7710...91e7',
        kind: 'device', pairedAt: NOW - 90 * DAY },
      { id: 'c-travel', identityId: 'i-personal', name: 'Travel BitBox',
        handle: 'quiet-heron-1177', pubkey: '02bc...77af',
        kind: 'device', pairedAt: NOW - 200 * DAY },
      { id: 'c-alice', identityId: 'i-personal', name: 'Alice Reyes',
        handle: 'bright-willow-3320', pubkey: '02aa...3320',
        kind: 'person', pairedAt: NOW - 400 * DAY },
      { id: 'c-bob', identityId: 'i-personal', name: 'Bob Martens',
        handle: 'amber-falcon-5512', pubkey: '03cc...5512',
        kind: 'person', pairedAt: NOW - 300 * DAY },
      { id: 'c-carol', identityId: 'i-personal', name: 'Carol Schmid',
        handle: 'granite-lynx-2089', pubkey: '02dd...2089',
        kind: 'person', pairedAt: NOW - 150 * DAY },
      { id: 'c-dave', identityId: 'i-personal', name: 'Dave Okonkwo',
        handle: 'nimble-fox-7704', pubkey: '03ee...7704',
        kind: 'person', pairedAt: NOW - 60 * DAY },
    ],
    docs: [
      {
        id: 'd-recovery', identityId: 'i-personal',
        title: 'Recovery instructions',
        body: 'Hardware wallet seed is in the safe at the cabin (north drawer).\n\nLawyer (Carol) has a sealed copy of these instructions and the safe combination.\n\nIf you cannot reach me, contact Carol first.',
        createdAt: NOW - 30 * DAY, updatedAt: NOW - 7 * DAY,
        recipients: [
          { contactId: 'c-alice', unlockDelayDays: 30 },
          { contactId: 'c-carol', unlockDelayDays: 90 },
          { contactId: 'c-bob', unlockDelayDays: 365 },
        ],
      },
      {
        id: 'd-family', identityId: 'i-personal',
        title: 'For my family',
        body: 'Some words I want you to read if I am not around. (demo)',
        createdAt: NOW - 120 * DAY, updatedAt: NOW - 5 * DAY,
        recipients: [
          { contactId: 'c-alice', unlockDelayDays: 30, releasedAt: NOW - 3 * DAY },
          { contactId: 'c-bob', unlockDelayDays: 90 },
        ],
      },
      {
        id: 'd-misc', identityId: 'i-personal',
        title: 'Misc notes',
        body: 'todo: bike service date, garage code',
        createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY,
        recipients: [],
      },
    ],
    messages: [
      { id: 'm1', identityId: 'i-personal', contactId: 'c-alice',
        from: 'me', body: 'Sent 0.025 BTC for the concert.', sentAt: NOW - 5 * DAY, readAt: NOW - 5 * DAY },
      { id: 'm2', identityId: 'i-personal', contactId: 'c-alice',
        from: 'them', body: 'Got it, thank you!', sentAt: NOW - 5 * DAY, readAt: NOW - 5 * DAY },
      { id: 'm3', identityId: 'i-personal', contactId: 'c-alice',
        from: 'me', body: 'Anytime.', sentAt: NOW - 4 * DAY, readAt: NOW - 4 * DAY },
      { id: 'm4', identityId: 'i-personal', contactId: 'c-alice',
        from: 'them', body: 'Got the payment, thanks! Dinner Saturday?', sentAt: NOW - 1 * DAY },
    ],
    requests: [
      { id: 'r-bob', identityId: 'i-personal', contactId: 'c-bob',
        direction: 'in', amountSats: 420_000, memo: 'Dinner split', status: 'pending', createdAt: NOW - 1 * DAY },
      { id: 'r-dave', identityId: 'i-personal', contactId: 'c-dave',
        direction: 'out', amountSats: 2_500_000, memo: 'Concert tickets', status: 'paid', createdAt: NOW - 2 * DAY },
    ],
  };
}
