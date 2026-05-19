# Cloud Features Mock — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a high-fidelity, clickable, frontend-only mock of a future "Cloud" section that demonstrates keystore-based identity, an address book with per-contact send/request/message actions, and an encrypted-document Tresor with per-recipient unlock delays.

**Architecture:** All code lives under `frontends/web/src/routes/cloud/`. A React context (`CloudMockProvider`) holds seeded in-memory state with selectors and mutations scoped to the currently-selected identity. No backend changes. No persistence — reload restores the seed. The existing QR component is reused.

**Tech Stack:** React + TypeScript, React Router v6, Vite, CSS Modules, react-i18next, Vitest + React Testing Library.

**Reference design:** [docs/plans/2026-05-19-cloud-features-mock-design.md](docs/plans/2026-05-19-cloud-features-mock-design.md)

## Conventions

- All paths are relative to the repository root unless noted.
- Component files: lowercase-hyphenated (e.g. `identity-card.tsx`) — match the existing `frontends/web/src/` style.
- CSS Modules: one `*.module.css` per component, imported as `style`.
- i18n: add English-only keys under a new top-level namespace `cloud.*` in `frontends/web/src/locales/en/app.json`. Other locales are not updated.
- Pure-JSX layout components are not unit-tested — TDD is applied only where it has real value: the state context, the deterministic avatar helper, and the Tresor status-pill derivation. Manual verification via the preview tools at the end of each visual task.
- Every task ends with a single commit. Commits are unsigned-untouched: if signing prompts, tap the security key.
- All TypeScript types live in `frontends/web/src/routes/cloud/state/types.ts` to avoid circular imports.

---

### Task 1: Scaffold types and seed data

**Files:**
- Create: `frontends/web/src/routes/cloud/state/types.ts`
- Create: `frontends/web/src/routes/cloud/state/seed.ts`

**Step 1: Add the types**

Create `frontends/web/src/routes/cloud/state/types.ts`:

```ts
export type Identity = {
  id: string;
  name: string;
  handle: string;
  pubkey: string;
  avatarSeed: string;
};

export type Contact = {
  id: string;
  identityId: string;
  name: string;
  handle: string;
  pubkey: string;
  kind: 'device' | 'person';
  pairedAt: number;
};

export type TresorRecipient = {
  contactId: string;
  unlockDelayDays: number | null;
  releasedAt?: number;
};

export type TresorDoc = {
  id: string;
  identityId: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  recipients: TresorRecipient[];
};

export type Message = {
  id: string;
  identityId: string;
  contactId: string;
  from: 'me' | 'them';
  body: string;
  sentAt: number;
  readAt?: number;
};

export type PaymentReq = {
  id: string;
  identityId: string;
  contactId: string;
  direction: 'in' | 'out';
  amountSats: number;
  memo: string;
  status: 'pending' | 'paid' | 'declined';
  createdAt: number;
};

export type CloudState = {
  identities: Identity[];
  contacts: Contact[];
  docs: TresorDoc[];
  messages: Message[];
  requests: PaymentReq[];
};
```

**Step 2: Add the seed**

Create `frontends/web/src/routes/cloud/state/seed.ts` matching the design's seeded data exactly (two identities, six contacts under Personal, three docs, ~4 messages with Alice, two payment requests). Use stable millisecond timestamps anchored at a fixed reference (`const NOW = Date.UTC(2026, 4, 19);`) so the seed is deterministic.

```ts
import type { CloudState } from './types';

const NOW = Date.UTC(2026, 4, 19);
const DAY = 86_400_000;

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
          { contactId: 'c-bob',   unlockDelayDays: 365 },
        ],
      },
      {
        id: 'd-family', identityId: 'i-personal',
        title: 'For my family',
        body: 'Some words I want you to read if I am not around. (demo)',
        createdAt: NOW - 120 * DAY, updatedAt: NOW - 5 * DAY,
        recipients: [
          { contactId: 'c-alice', unlockDelayDays: 30, releasedAt: NOW - 3 * DAY },
          { contactId: 'c-bob',   unlockDelayDays: 90 },
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
        from: 'me',   body: 'Sent 0.025 BTC for the concert.', sentAt: NOW - 5 * DAY, readAt: NOW - 5 * DAY },
      { id: 'm2', identityId: 'i-personal', contactId: 'c-alice',
        from: 'them', body: 'Got it, thank you!',              sentAt: NOW - 5 * DAY, readAt: NOW - 5 * DAY },
      { id: 'm3', identityId: 'i-personal', contactId: 'c-alice',
        from: 'me',   body: 'Anytime.',                        sentAt: NOW - 4 * DAY, readAt: NOW - 4 * DAY },
      { id: 'm4', identityId: 'i-personal', contactId: 'c-alice',
        from: 'them', body: 'Got the payment, thanks! Dinner Saturday?', sentAt: NOW - 1 * DAY },
    ],
    requests: [
      { id: 'r-bob',  identityId: 'i-personal', contactId: 'c-bob',
        direction: 'in',  amountSats: 420_000, memo: 'Dinner split',     status: 'pending', createdAt: NOW - 1 * DAY },
      { id: 'r-dave', identityId: 'i-personal', contactId: 'c-dave',
        direction: 'out', amountSats: 2_500_000, memo: 'Concert tickets', status: 'paid',    createdAt: NOW - 2 * DAY },
    ],
  };
}
```

**Step 3: Commit**

```bash
git add frontends/web/src/routes/cloud/state/types.ts \
        frontends/web/src/routes/cloud/state/seed.ts
git commit -m "cloud-mock: add state types and seed data"
```

---

### Task 2: State context (with tests)

**Files:**
- Create: `frontends/web/src/routes/cloud/state/context.tsx`
- Create: `frontends/web/src/routes/cloud/state/context.test.tsx`

**Step 1: Write failing tests**

Create `frontends/web/src/routes/cloud/state/context.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CloudMockProvider, useCloud } from './context';

const wrapper = ({ children }: { children: ReactNode }) => (
  <CloudMockProvider>{children}</CloudMockProvider>
);

describe('CloudMockProvider', () => {
  it('starts with Personal selected and exposes its contacts', () => {
    const { result } = renderHook(() => useCloud(), { wrapper });
    expect(result.current.currentIdentity.name).toBe('Personal');
    expect(result.current.contacts.length).toBe(6);
  });

  it('switching identity scopes selectors to that identity', () => {
    const { result } = renderHook(() => useCloud(), { wrapper });
    act(() => result.current.setCurrentIdentityId('i-family'));
    expect(result.current.currentIdentity.name).toBe('Family Savings');
    expect(result.current.contacts.every(c => c.identityId === 'i-family')).toBe(true);
  });

  it('sendMessage appends a "me" message to the contact thread', () => {
    const { result } = renderHook(() => useCloud(), { wrapper });
    const before = result.current.messages('c-alice').length;
    act(() => result.current.sendMessage('c-alice', 'hi'));
    const after = result.current.messages('c-alice');
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({ from: 'me', body: 'hi' });
  });

  it('markRequestPaid flips the status', () => {
    const { result } = renderHook(() => useCloud(), { wrapper });
    act(() => result.current.markRequestPaid('r-bob'));
    expect(result.current.requests.find(r => r.id === 'r-bob')?.status).toBe('paid');
  });

  it('createDoc adds a draft scoped to the current identity', () => {
    const { result } = renderHook(() => useCloud(), { wrapper });
    let newId = '';
    act(() => { newId = result.current.createDoc({ title: 'T', body: 'B' }); });
    const doc = result.current.docs.find(d => d.id === newId);
    expect(doc).toBeDefined();
    expect(doc!.identityId).toBe('i-personal');
    expect(doc!.recipients).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

```
npx --prefix frontends/web vitest run src/routes/cloud/state/context.test.tsx
```

Expected: FAIL — module `./context` does not exist.

**Step 3: Implement the context**

Create `frontends/web/src/routes/cloud/state/context.tsx`:

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CloudState, Contact, Message, PaymentReq, TresorDoc, Identity } from './types';
import { buildSeed } from './seed';

type CreateDocInput = { title: string; body: string };

type CloudCtx = {
  currentIdentity: Identity;
  identities: Identity[];
  setCurrentIdentityId: (id: string) => void;
  contacts: Contact[];
  docs: TresorDoc[];
  requests: PaymentReq[];
  messages: (contactId: string) => Message[];
  addContact: (c: Omit<Contact, 'id' | 'identityId' | 'pairedAt'>) => string;
  createDoc: (input: CreateDocInput) => string;
  updateDoc: (id: string, patch: Partial<Pick<TresorDoc, 'title' | 'body' | 'recipients'>>) => void;
  sendMessage: (contactId: string, body: string) => void;
  markMessageRead: (id: string) => void;
  createRequest: (input: { contactId: string; amountSats: number; memo: string }) => void;
  markRequestPaid: (id: string) => void;
  markRequestDeclined: (id: string) => void;
};

const Context = createContext<CloudCtx | null>(null);

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++counter}`;

export const CloudMockProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<CloudState>(() => buildSeed());
  const [currentIdentityId, setCurrentIdentityId] = useState<string>('i-personal');

  const currentIdentity = state.identities.find(i => i.id === currentIdentityId)!;

  const contacts = useMemo(
    () => state.contacts.filter(c => c.identityId === currentIdentityId),
    [state.contacts, currentIdentityId],
  );
  const docs = useMemo(
    () => state.docs.filter(d => d.identityId === currentIdentityId),
    [state.docs, currentIdentityId],
  );
  const requests = useMemo(
    () => state.requests.filter(r => r.identityId === currentIdentityId),
    [state.requests, currentIdentityId],
  );
  const messages = useCallback(
    (contactId: string) => state.messages
      .filter(m => m.identityId === currentIdentityId && m.contactId === contactId)
      .sort((a, b) => a.sentAt - b.sentAt),
    [state.messages, currentIdentityId],
  );

  const addContact: CloudCtx['addContact'] = useCallback((c) => {
    const id = nextId('c');
    setState(s => ({
      ...s,
      contacts: [...s.contacts, { ...c, id, identityId: currentIdentityId, pairedAt: Date.now() }],
    }));
    return id;
  }, [currentIdentityId]);

  const createDoc: CloudCtx['createDoc'] = useCallback(({ title, body }) => {
    const id = nextId('d');
    const ts = Date.now();
    setState(s => ({
      ...s,
      docs: [...s.docs, { id, identityId: currentIdentityId, title, body, createdAt: ts, updatedAt: ts, recipients: [] }],
    }));
    return id;
  }, [currentIdentityId]);

  const updateDoc: CloudCtx['updateDoc'] = useCallback((id, patch) => {
    setState(s => ({
      ...s,
      docs: s.docs.map(d => d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d),
    }));
  }, []);

  const sendMessage: CloudCtx['sendMessage'] = useCallback((contactId, body) => {
    setState(s => ({
      ...s,
      messages: [...s.messages, {
        id: nextId('m'), identityId: currentIdentityId, contactId,
        from: 'me', body, sentAt: Date.now(), readAt: Date.now(),
      }],
    }));
  }, [currentIdentityId]);

  const markMessageRead: CloudCtx['markMessageRead'] = useCallback((id) => {
    setState(s => ({
      ...s,
      messages: s.messages.map(m => m.id === id ? { ...m, readAt: Date.now() } : m),
    }));
  }, []);

  const createRequest: CloudCtx['createRequest'] = useCallback(({ contactId, amountSats, memo }) => {
    setState(s => ({
      ...s,
      requests: [...s.requests, {
        id: nextId('r'), identityId: currentIdentityId, contactId,
        direction: 'out', amountSats, memo, status: 'pending', createdAt: Date.now(),
      }],
    }));
  }, [currentIdentityId]);

  const setRequestStatus = (id: string, status: PaymentReq['status']) => {
    setState(s => ({ ...s, requests: s.requests.map(r => r.id === id ? { ...r, status } : r) }));
  };
  const markRequestPaid = useCallback((id: string) => setRequestStatus(id, 'paid'), []);
  const markRequestDeclined = useCallback((id: string) => setRequestStatus(id, 'declined'), []);

  const value: CloudCtx = {
    currentIdentity, identities: state.identities, setCurrentIdentityId,
    contacts, docs, requests, messages,
    addContact, createDoc, updateDoc,
    sendMessage, markMessageRead,
    createRequest, markRequestPaid, markRequestDeclined,
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
};

export const useCloud = () => {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useCloud must be used inside CloudMockProvider');
  return ctx;
};
```

**Step 4: Run tests to verify they pass**

```
npx --prefix frontends/web vitest run src/routes/cloud/state/context.test.tsx
```

Expected: 5 passing.

**Step 5: Commit**

```bash
git add frontends/web/src/routes/cloud/state/context.tsx \
        frontends/web/src/routes/cloud/state/context.test.tsx
git commit -m "cloud-mock: add in-memory state context"
```

---

### Task 3: Avatar helper (deterministic gradient) with tests

**Files:**
- Create: `frontends/web/src/routes/cloud/components/avatar.tsx`
- Create: `frontends/web/src/routes/cloud/components/avatar.module.css`
- Create: `frontends/web/src/routes/cloud/components/avatar.test.tsx`

**Step 1: Write failing tests**

```tsx
import { describe, expect, it } from 'vitest';
import { gradientFromSeed } from './avatar';

describe('gradientFromSeed', () => {
  it('returns the same gradient for the same seed', () => {
    expect(gradientFromSeed('alice')).toEqual(gradientFromSeed('alice'));
  });
  it('returns different gradients for different seeds', () => {
    expect(gradientFromSeed('alice')).not.toEqual(gradientFromSeed('bob'));
  });
  it('uses two colors from the palette', () => {
    const { from, to } = gradientFromSeed('alice');
    expect(from).toMatch(/^#[0-9a-f]{6}$/);
    expect(to).toMatch(/^#[0-9a-f]{6}$/);
    expect(from).not.toBe(to);
  });
});
```

**Step 2: Run to verify it fails**

```
npx --prefix frontends/web vitest run src/routes/cloud/components/avatar.test.tsx
```

**Step 3: Implement avatar**

Create `frontends/web/src/routes/cloud/components/avatar.tsx`:

```tsx
import style from './avatar.module.css';

const PALETTE = ['#5b8def', '#7b61ff', '#e85d75', '#f4a261', '#2ec27e', '#34c5d4', '#c084fc', '#fbbf24'];

const hash = (s: string) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export const gradientFromSeed = (seed: string) => {
  const h = hash(seed);
  const a = PALETTE[h % PALETTE.length];
  const b = PALETTE[(Math.floor(h / PALETTE.length) + 1) % PALETTE.length];
  return { from: a, to: a === b ? PALETTE[(h + 3) % PALETTE.length] : b };
};

type Props = { seed: string; label?: string; size?: number };

export const Avatar = ({ seed, label, size = 32 }: Props) => {
  const { from, to } = gradientFromSeed(seed);
  return (
    <div
      className={style.avatar}
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${from}, ${to})`, fontSize: size * 0.4 }}
      aria-hidden={!label}>
      {label && <span>{label.slice(0, 1).toUpperCase()}</span>}
    </div>
  );
};
```

Create `frontends/web/src/routes/cloud/components/avatar.module.css`:

```css
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: white;
  font-weight: 600;
  flex-shrink: 0;
}
```

**Step 4: Run tests**

```
npx --prefix frontends/web vitest run src/routes/cloud/components/avatar.test.tsx
```

Expected: 3 passing.

**Step 5: Commit**

```bash
git add frontends/web/src/routes/cloud/components/avatar.tsx \
        frontends/web/src/routes/cloud/components/avatar.module.css \
        frontends/web/src/routes/cloud/components/avatar.test.tsx
git commit -m "cloud-mock: add deterministic avatar helper"
```

---

### Task 4: Tresor status helper (with tests)

**Files:**
- Create: `frontends/web/src/routes/cloud/tresor/status.ts`
- Create: `frontends/web/src/routes/cloud/tresor/status.test.ts`

**Step 1: Failing tests**

```ts
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
    ]});
    expect(s).toEqual({ kind: 'at-risk', days: 30 });
  });
  it('reports released when at least one recipient has releasedAt', () => {
    const s = docStatus({ ...base, recipients: [
      { contactId: 'c1', unlockDelayDays: 30, releasedAt: 1 },
      { contactId: 'c2', unlockDelayDays: 90 },
    ]});
    expect(s.kind).toBe('released');
    if (s.kind === 'released') expect(s.contactId).toBe('c1');
  });
});
```

**Step 2: Run failing**

```
npx --prefix frontends/web vitest run src/routes/cloud/tresor/status.test.ts
```

**Step 3: Implement**

Create `frontends/web/src/routes/cloud/tresor/status.ts`:

```ts
import type { TresorDoc } from '../state/types';

export type DocStatus =
  | { kind: 'draft' }
  | { kind: 'sealed' }
  | { kind: 'at-risk'; days: number }
  | { kind: 'released'; contactId: string; releasedAt: number };

export const docStatus = (d: TresorDoc): DocStatus => {
  if (d.recipients.length === 0) return { kind: 'draft' };
  const released = d.recipients.find(r => r.releasedAt !== undefined);
  if (released) return { kind: 'released', contactId: released.contactId, releasedAt: released.releasedAt! };
  const timers = d.recipients
    .filter(r => r.unlockDelayDays !== null && r.releasedAt === undefined)
    .map(r => r.unlockDelayDays as number);
  if (timers.length === 0) return { kind: 'sealed' };
  return { kind: 'at-risk', days: Math.min(...timers) };
};
```

**Step 4: Pass**

```
npx --prefix frontends/web vitest run src/routes/cloud/tresor/status.test.ts
```

Expected: 4 passing.

**Step 5: Commit**

```bash
git add frontends/web/src/routes/cloud/tresor/status.ts \
        frontends/web/src/routes/cloud/tresor/status.test.ts
git commit -m "cloud-mock: add tresor doc status helper"
```

---

### Task 5: Sidebar entry + Cloud route mount + dashboard placeholder

**Files:**
- Modify: `frontends/web/src/components/sidebar/sidebar.tsx` (add NavLink to `/cloud` directly above the Settings entry — placement after the closing `</> ) : null }` of the accounts-gated services group, but BEFORE the Settings `<div key="settings">`. It is shown unconditionally, like Settings.)
- Modify: `frontends/web/src/routes/router.tsx` (add `<Route path="cloud">…</Route>` block inside the top-level `<Route path="/">`, wrap with `<CloudMockProvider>`, mount placeholder `<CloudDashboard />`)
- Create: `frontends/web/src/routes/cloud/index.tsx` — placeholder rendering "Cloud" `<h1>` + a `data-testid="cloud-dashboard-placeholder"` div
- Create: `frontends/web/src/routes/cloud/cloud.module.css` — empty for now
- Modify: `frontends/web/src/locales/en/app.json` — add `"cloud": { "title": "Cloud" }`

**Step 1: Icon**

Reuse an existing icon. Use the same `Coins`/`ShieldLight` pattern: import a `CloudLight` from `@/components/icon`. If that icon doesn't exist, fall back to a small inline SVG defined at the top of `sidebar.tsx`. Investigate available icons in `frontends/web/src/components/icon/` first; pick the closest match (cloud, share, link, identity-card style icon) and note the chosen name in the commit.

**Step 2: Sidebar wiring**

Insert before the `<div key="settings">` block (around line 185 of sidebar.tsx):

```tsx
<div key="cloud" className={style.sidebarItem}>
  <NavLink
    className={({ isActive }) => isActive ? style.sidebarActive : ''}
    to="/cloud"
    title={t('cloud.title')}
    onClick={handleSidebarItemClick}>
    <div className={style.single}>
      <CloudLight alt={t('cloud.title')} />
    </div>
    <span className={style.sidebarLabel}>{t('cloud.title')}</span>
  </NavLink>
</div>
```

**Step 3: Router wiring**

In `router.tsx`, add the import:

```tsx
import { CloudMockProvider } from './cloud/state/context';
import { CloudDashboard } from './cloud';
```

Inside `<Routes><Route path="/">`, add as a sibling to `<Route path="market">`:

```tsx
<Route path="cloud" element={<CloudMockProvider><Outlet /></CloudMockProvider>}>
  <Route index element={<CloudDashboard />} />
</Route>
```

Add `Outlet` to the existing `react-router-dom` import line.

**Step 4: Placeholder dashboard**

Create `frontends/web/src/routes/cloud/index.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

export const CloudDashboard = () => {
  const { t } = useTranslation();
  return (
    <section>
      <h1>{t('cloud.title')}</h1>
      <div data-testid="cloud-dashboard-placeholder" />
    </section>
  );
};
```

**Step 5: i18n**

Add the namespace block to `frontends/web/src/locales/en/app.json`. Be careful about JSON commas — find a sibling top-level key and insert next to it.

**Step 6: Manual verify with preview tools**

Start the dev servers in background per `CLAUDE.md` memory: `make webdev` and `make servewallet`. Navigate to `http://localhost:8080` then click the Cloud sidebar item. Confirm the `/cloud` route renders the `<h1>Cloud</h1>`. `preview_snapshot` to verify; `preview_screenshot` for the demo log.

**Step 7: Commit**

```bash
git add frontends/web/src/components/sidebar/sidebar.tsx \
        frontends/web/src/routes/router.tsx \
        frontends/web/src/routes/cloud/index.tsx \
        frontends/web/src/routes/cloud/cloud.module.css \
        frontends/web/src/locales/en/app.json
git commit -m "cloud-mock: add Cloud sidebar entry and route stub"
```

---

### Task 6: Demo banner

**Files:**
- Create: `frontends/web/src/routes/cloud/components/demo-banner.tsx`
- Create: `frontends/web/src/routes/cloud/components/demo-banner.module.css`
- Modify: `frontends/web/src/routes/cloud/index.tsx` (render banner at the top — but since we'll soon make this a layout component, just inline it here)
- Modify: `frontends/web/src/locales/en/app.json` — add `cloud.demoBanner` strings.

The banner: full-width slim bar, distinct background (use a warning-ish hue from existing CSS vars if available), text "Demo · no data is sent. Reload restores the seeded state.", a small × on the right that hides it for the current session via local state.

Render the banner inside the `<CloudMockProvider>` route element so it appears on all `/cloud/*` pages, not just the dashboard. Update router.tsx accordingly: create a tiny `<CloudLayout>` component that renders `<DemoBanner /><Outlet />` and use it as the element wrapper.

**Step 1-2: Implement layout + banner.**
**Step 3: Manual verify** — banner appears on `/cloud`. Click × to dismiss; refresh shows it again.
**Step 4: Commit:**

```bash
git commit -am "cloud-mock: add demo banner across /cloud pages"
```

---

### Task 7: Identity selector

**Files:**
- Create: `frontends/web/src/routes/cloud/components/identity-selector.tsx`
- Create: `frontends/web/src/routes/cloud/components/identity-selector.module.css`
- Modify: `frontends/web/src/routes/cloud/index.tsx`
- Modify: `frontends/web/src/locales/en/app.json`

**Behavior:** sticky horizontal bar at the top of the dashboard (below the demo banner). Avatar + identity name + chevron. Click toggles a dropdown menu listing all `identities` from the context — each row: avatar, name, handle in mono small-text. Clicking a row calls `setCurrentIdentityId`. Outside-click closes.

Use existing dropdown styling if the codebase has one; otherwise raw `position: absolute` menu. Add an accessibility wrapper (button with `aria-haspopup="menu"`, items as `role="menuitem"`).

**Manual verify:** click selector, switch to "Family Savings". Confirm the dashboard header text updates.

**Commit:** `cloud-mock: add identity selector`.

---

### Task 8: Identity card with QR

**Files:**
- Create: `frontends/web/src/routes/cloud/components/identity-card.tsx`
- Create: `frontends/web/src/routes/cloud/components/identity-card.module.css`
- Modify: `frontends/web/src/routes/cloud/index.tsx`
- Modify: `frontends/web/src/locales/en/app.json`

**QR:** import the existing component from `@/components/qrcode/qrcode`. Inspect its props by reading the file first; pass the identity payload as a single string: `bitbox:${handle}?pk=${pubkey}` (mock format — does not need to be a real spec).

**Layout:** flex row on wide screens, column on narrow. Left: QR ~180px. Right column: large word-handle, mono truncated pubkey, two buttons (Copy / Share). Copy writes the identity string to the clipboard via `navigator.clipboard.writeText` and shows a transient "Copied" pill. Share is a no-op that opens an alert/toast in the mock.

Footer line beneath: `t('cloud.identityCard.privacyHint')` → "Others can scan this to add you. Nothing is stored on a server until you add a contact."

**Manual verify:** QR renders. Copy puts the string on the clipboard (use `preview_eval('navigator.clipboard.readText()')` to confirm). Switching identity swaps the QR + handle.

**Commit:** `cloud-mock: add identity card with QR`.

---

### Task 9: Feature tiles + dashboard composition

**Files:**
- Create: `frontends/web/src/routes/cloud/components/feature-tile.tsx`
- Create: `frontends/web/src/routes/cloud/components/feature-tile.module.css`
- Modify: `frontends/web/src/routes/cloud/index.tsx` — final composition: `<IdentitySelector /><IdentityCard /><div className={style.tiles}><FeatureTile to="/cloud/contacts" .../><FeatureTile to="/cloud/tresor" .../></div>`
- Modify: i18n

Tiles: large rounded card, two per row on wide screens, stacked on narrow. Each tile: icon (top-left), title, subtitle ("N contacts" / "N documents" — derived from `useCloud()`), hover lift, click navigates with `<Link>`.

**Manual verify** — tiles render, hovering lifts, clicking the Contacts tile navigates to `/cloud/contacts` (which 404s for now until task 10). Confirm the count subtitles read "6 contacts" and "3 documents" on Personal, change when switched to Family Savings (which has 0/0).

**Commit:** `cloud-mock: add dashboard feature tiles`.

---

### Task 10: Address book list page

**Files:**
- Create: `frontends/web/src/routes/cloud/contacts/list.tsx`
- Create: `frontends/web/src/routes/cloud/contacts/list.module.css`
- Modify: `frontends/web/src/routes/router.tsx` — add `<Route path="contacts" element={<ContactsList />} />`
- Modify: i18n

Render:

- Header row: title "Address book", search input (filters by name/handle, case-insensitive), `+ Add contact` button → `/cloud/contacts/add`.
- Inbox banner directly below header: only renders when `requests.filter(pending) || messages with unreadAt undefined` is non-empty. Text: `"{n} pending payment request(s) · {m} unread message(s)"`. Click expands inline to a small list of items, each with a "View" link to the relevant contact.
- Two grouped sections, each with subheader:
  - **My devices** — `contacts.filter(c => c.kind === 'device')`
  - **People** — `contacts.filter(c => c.kind === 'person')`
- Row layout: `<Avatar seed={c.handle} label={c.name}/>` + name + handle (small mono) + badges on the right (red dot if has unread, "$" pill if has incoming request).

`<Link to={\`/cloud/contacts/${c.id}\`}>` wraps each row.

**Manual verify:** navigate to `/cloud/contacts`. Confirm banner shows "1 pending payment request · 1 unread message". Two groups visible with expected names.

**Commit:** `cloud-mock: address book list page`.

---

### Task 11: Add contact page

**Files:**
- Create: `frontends/web/src/routes/cloud/contacts/add.tsx`
- Create: `frontends/web/src/routes/cloud/contacts/add.module.css`
- Modify: `frontends/web/src/routes/router.tsx` — `<Route path="contacts/add" element={<AddContact />} />` (note: place BEFORE the `:id` route to avoid path collision)
- Modify: i18n

Two tabs (use existing Tabs component if present in `frontends/web/src/components`; else simple buttons toggling local state):

- **Scan QR:** a placeholder rectangle (border-dashed) with text "Camera preview unavailable in mock." and a `Use sample QR` button that fills in a fake payload `bitbox:cedar-thrush-6611?pk=02fe...11ab`.
- **Paste handle:** text input. On Continue, parse handle from input (just strip a leading `bitbox:` if present).

Both paths lead to a confirmation card: avatar, resolved name (faked: `New contact`), handle, pubkey. Editable Nickname field. **Add to contacts** primary button — calls `addContact` and navigates back to `/cloud/contacts`.

**Manual verify:** add a contact via the Paste-handle tab. Confirm it appears under People in the list.

**Commit:** `cloud-mock: add-contact flow`.

---

### Task 12: Contact detail page — header + action row scaffold

**Files:**
- Create: `frontends/web/src/routes/cloud/contacts/detail.tsx`
- Create: `frontends/web/src/routes/cloud/contacts/detail.module.css`
- Modify: `frontends/web/src/routes/router.tsx` — `<Route path="contacts/:contactId" element={<ContactDetail />} />`
- Modify: i18n

Header: avatar (large, 64px), name, handle in mono, verified-pairing check icon for `kind: 'device'` or seeded contacts (add a `verifiedHandles` set). "..." menu (just a button; menu items log to console for now — Rename/Remove flows are out of scope for the mock).

Action row: three buttons side-by-side. Each is wired in subsequent tasks; for now just show the three buttons with onClick stubs that `console.log`.

Below the action row, a `<Tabs>` with two empty placeholder tabs: Messages, Activity. Implement the tab switcher state.

**Manual verify:** navigate from a contact row. Confirm header, three buttons, two tab labels.

**Commit:** `cloud-mock: contact detail scaffold`.

---

### Task 13: Contact detail — Messages tab

**Files:**
- Modify: `frontends/web/src/routes/cloud/contacts/detail.tsx`
- Create: `frontends/web/src/routes/cloud/contacts/messages-tab.tsx`
- Create: `frontends/web/src/routes/cloud/contacts/messages-tab.module.css`
- Modify: i18n

Renders the message thread for the active contact. Bubble layout: right-aligned for `from === 'me'`, left-aligned otherwise. Timestamp under each bubble in small grey text.

E2EE reassurance line at the top: "Messages with {name} are end-to-end encrypted." (mock — no encryption).

Compose area at the bottom: a textarea + send button. On send, call `sendMessage(contactId, body)`, clear the textarea. Auto-scroll to bottom on mount and after send (`useEffect`/ref).

On tab mount, call `markMessageRead` for all unread messages on the thread.

The "Message" action-row button on the contact detail sets the active tab to Messages and focuses the textarea.

**Manual verify:** Open Alice's contact. Switch to Messages tab — confirm the seeded thread renders, the last unread message is now marked read (no red dot on the contact list when returning). Type a message and send.

**Commit:** `cloud-mock: contact messages tab`.

---

### Task 14: Contact detail — Activity tab + Request dialog + Send-BTC stub

**Files:**
- Modify: `frontends/web/src/routes/cloud/contacts/detail.tsx`
- Create: `frontends/web/src/routes/cloud/contacts/activity-tab.tsx`
- Create: `frontends/web/src/routes/cloud/contacts/request-dialog.tsx`
- Create: `frontends/web/src/routes/cloud/contacts/send-btc-dialog.tsx`
- Modify: i18n

**Activity tab:** chronological list (newest first) of `requests` filtered by contactId, plus a synthetic "Contact paired on …" event at the bottom from `contact.pairedAt`. Each request row: direction arrow (↘ in / ↗ out), amount with sats→BTC formatting (reuse any existing amount-format util if present, otherwise a tiny helper `sats/1e8`), memo, status pill (Pending / Paid / Declined — three colors). For pending incoming requests, two small buttons: "Mark paid" → `markRequestPaid`, "Decline" → `markRequestDeclined`.

**Request payment button** on the action row opens `RequestDialog`: a modal with amount input (BTC, with placeholder "0.001") and memo input. Submit calls `createRequest({ contactId, amountSats, memo })` and closes the dialog. The new request appears in the Activity tab immediately.

**Send BTC button** opens `SendBtcDialog`: a stub modal that shows:
- "To: {name} (via payment code)" with the contact's name.
- A non-editable address field showing a derived-looking value `bc1q...{handle-derived-suffix}` with a small "via payment code" badge.
- Amount input.
- A primary "Send" button which is a no-op (closes the dialog and shows a toast "Demo — transaction not sent").

Don't reuse the real send flow — wiring it would force backend mocking. The mock dialog reads as obviously demo.

**Manual verify:** Open Bob's contact. Activity tab shows the pending incoming "Dinner split". Click "Mark paid" — the pill flips to Paid, inbox banner count on `/cloud/contacts` decreases. Open Request dialog, submit a request to Alice — it appears in her Activity.

**Commit:** `cloud-mock: contact activity, request dialog, send-btc stub`.

---

### Task 15: Tresor list page

**Files:**
- Create: `frontends/web/src/routes/cloud/tresor/list.tsx`
- Create: `frontends/web/src/routes/cloud/tresor/list.module.css`
- Create: `frontends/web/src/routes/cloud/tresor/recipient-row-preview.tsx` (small avatar-cluster component reused in cards)
- Modify: `frontends/web/src/routes/router.tsx`
- Modify: i18n

Renders `useCloud().docs` as card-rows. Each card uses `docStatus(doc)` from Task 4 to render the status pill:

| status.kind | pill text | pill color class |
|---|---|---|
| draft | "Draft" | neutral |
| sealed | "Sealed" | info |
| at-risk | `t('cloud.tresor.atRisk', { count: status.days })` → "At risk in 30 days" | warn |
| released | `t('cloud.tresor.releasedTo', { name }) + " (demo)"` | accent |

Lock icon: filled for non-draft, outline for draft. Card click navigates to `/cloud/tresor/:id`.

Top of page: title "Tresor", tagline, `+ New document` button → `/cloud/tresor/new`.

**Manual verify:** Three cards shown. Status pills read "At risk in 30 days", "Released to Alice (demo)", "Draft".

**Commit:** `cloud-mock: tresor list page`.

---

### Task 16: Tresor editor — title/body/autosave

**Files:**
- Create: `frontends/web/src/routes/cloud/tresor/editor.tsx`
- Create: `frontends/web/src/routes/cloud/tresor/editor.module.css`
- Modify: `frontends/web/src/routes/router.tsx` — routes for `tresor/new` and `tresor/:docId`
- Modify: i18n

Two-column layout (CSS grid `1fr 320px`; collapse to one column under ~720px).

Left column:
- Title input — large, borderless, `placeholder="Untitled"`.
- Body — `<textarea>` styled large, no toolbar. Min height ~50vh.
- Auto-save: on blur of either field, call `updateDoc(id, { title, body })`. For the `new` route, on first blur call `createDoc({title, body})` then `navigate(/cloud/tresor/${id}, { replace: true })`.
- Status text below the editor: "Sealed · last updated 2m ago" — derive from `doc.updatedAt`. If no recipients, "Draft · last edited …".

Right column for now: just a placeholder `<aside>` with "Recipients & timers — coming next task".

**Manual verify:** Click `+ New document`. Type a title and body. Blur → URL changes to `/cloud/tresor/<id>`. Navigate back to list — new card appears under Drafts.

**Commit:** `cloud-mock: tresor editor (title + body)`.

---

### Task 17: Tresor editor — recipients & timers

**Files:**
- Modify: `frontends/web/src/routes/cloud/tresor/editor.tsx`
- Create: `frontends/web/src/routes/cloud/tresor/recipients-panel.tsx`
- Create: `frontends/web/src/routes/cloud/tresor/recipients-panel.module.css`
- Create: `frontends/web/src/routes/cloud/tresor/contact-picker.tsx` — modal listing contacts
- Modify: i18n

Right column panel:
- Header "Recipients & timers".
- `+ Add recipient` button → opens `ContactPicker` modal listing all current-identity contacts not already on this doc. Filterable. Selecting one calls `updateDoc(id, { recipients: [...current, { contactId, unlockDelayDays: null }] })`.
- Per-recipient row: `<Avatar>`, name, handle, **Unlock delay** `<select>` with options:
  - `null` → "Never"
  - 30 → "30 days"
  - 90 → "90 days"
  - 365 → "1 year"
  - `'custom'` → opens an inline number-input + unit selector (days/months/years; convert to days on commit)
  Change writes back via `updateDoc`.
- Help-tooltip icon next to the select — hover/click shows "{name} can decrypt if you don't check in with the cloud for this long."
- Remove (×) button at the end of the row → removes the recipient.
- For recipients with `releasedAt` set: show a small unlocked icon and `Released ${ago}` instead of the select; the select is replaced.
- Footer line: aggregate computed from `docStatus(doc)`:
  - Draft → "Add a recipient to seal this document."
  - Sealed (all null) → "Sealed for N recipients. No automatic release."
  - At-risk → "Sealed for N recipients. Earliest release: M days of silence."
  - Released → "Released to {name}. M other recipient(s) pending."

**Manual verify:** Open the "Recovery instructions" doc. Confirm 3 recipients show with correct delays. Change Alice's delay to 90 — footer recomputes ("Earliest release: 90 days"). Add a 4th recipient via the picker. Remove it. Open the "For my family" doc — confirm Alice's row reads "Released 3 days ago" with no select.

**Commit:** `cloud-mock: tresor recipients & timers`.

---

### Task 18: Tresor view (read-only mode toggle)

**Files:**
- Modify: `frontends/web/src/routes/cloud/tresor/editor.tsx`

When entering `/cloud/tresor/:docId` (not `new`), the body renders read-only by default — a `<div>` with whitespace-preserving CSS (`white-space: pre-wrap`). An **Edit** button top-right switches to the editable textarea. After blur-save, switch back to read-only.

Recipients panel: same idea — read-only chip rows by default; **Edit** reveals the controls. Or alternatively keep recipients always editable (low-cost change). Choose always-editable for simplicity (note this decision in the commit message).

**Manual verify:** Open "Recovery instructions". Body shows read-only. Click Edit. Modify, blur, returns to read-only.

**Commit:** `cloud-mock: tresor read-only view with Edit toggle`.

---

### Task 19: End-to-end manual verification

**No code changes.** Walk through these flows in the running app and capture screenshots:

1. Land on `/cloud` after fresh load — identity selector defaults to Personal, identity card renders QR + handle, two tiles read "6 contacts" / "3 documents".
2. Switch identity to "Family Savings" — QR changes, tiles read "0 contacts" / "0 documents", banner reads correctly.
3. Switch back to Personal. Click Address book tile → list page. Confirm inbox banner reads "1 pending payment request · 1 unread message".
4. Click Alice → Messages tab opens with seeded thread; the "Got the payment, thanks!" message is now marked read. Send a new message, verify it appears.
5. Click Bob → Activity tab. Mark the dinner-split request paid. Verify the inbox banner on `/cloud/contacts` no longer mentions it.
6. Click Request payment on Carol → create a 0.005 BTC "test" request. Confirm it appears in Carol's Activity as Pending Out.
7. Click Send BTC on Carol → demo dialog opens with `bc1q...` faux address. Close.
8. Back to dashboard → Tresor tile → list. Click "Recovery instructions" — read-only body, three recipients visible. Click Edit, change body, blur — saves.
9. Open "For my family" — Alice row shows "Released 3 days ago"; pill on list reads "Released to Alice (demo)".
10. Click + New document → type title "Test", body "Hello", blur — auto-saves, URL has new id, list now shows 4 cards.
11. Reload `/cloud` — confirm all of the above resets to seed.

Use `preview_screenshot` after each major step. Take particular care with steps 2, 4, 7, 9 — these are the demo highlights.

**Commit:** none (verification only). If issues are found, fix them in their own task-shaped commit with the same TDD discipline.

---

### Task 20: Final polish pass

Open items and risk mitigations from the design doc:
- Confirm the "Released to Alice" pill carries a `(demo)` suffix.
- Confirm the demo banner is visible on every `/cloud/*` route.
- Confirm i18n keys all resolve (no raw key strings visible in screenshots).
- Run `npm --prefix frontends/web run lint` and address any new warnings.
- Run the full vitest suite: `npm --prefix frontends/web test -- --run`. Expected: all green (new tests passing, no existing tests broken).

**Commit:** `cloud-mock: lint and polish pass` if any cleanups were made.

---

## Completion criteria

- Sidebar shows a "Cloud" entry that navigates to `/cloud`.
- The dashboard, address book, and tresor pages all render and are clickable end-to-end on seeded data.
- The five seeded demo highlights are visible: word-handle + QR identity, identity switch, inbox banner, "Released to Alice (demo)", at-risk timer countdown.
- All new vitest tests pass; no existing tests broken.
- No Go code changed.
- Design doc and this plan committed.
