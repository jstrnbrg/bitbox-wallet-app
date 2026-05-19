# Cloud features — UI mock design

**Date:** 2026-05-19
**Status:** Approved (brainstorming complete)
**Scope:** Frontend-only, non-functional demo. No backend, no real cryptography, no persistence across reloads.

## Goal

Mock up a "Cloud" section in the BitBoxApp web frontend that shows how a future BitBoxCloud-backed feature set could look. The mock should feel real enough to demo to stakeholders without claiming to ship the underlying service.

Features illustrated:

- A keystore-derived public identity (QR + word-handle) for being added by others.
- An address book of other keystores (own devices + people), with per-contact actions: send BTC, request payment, send a secure message.
- A "Tresor" of encrypted documents with per-recipient unlock delays (dead-man-switch semantics).

## Non-goals

- No Go backend changes.
- No real cryptography. QR contents and "encrypted" docs are seeded plain strings.
- No persistence. Reloading `/cloud/*` returns to seed.
- No real camera access for QR scanning — a placeholder with a "Use sample QR" button.
- No "Manage identities" page. The selector lists the two seeded identities only.
- No translations beyond English. Other locales fall back to English keys.
- No mobile-app changes.

## Approach

**Frontend-only mock, no backend.** All code under `frontends/web/src/routes/cloud/`. Fake data lives in `state/seed.ts`. A React context (`CloudMockContext`) holds state in memory and exposes selectors filtered by the current identity, plus mutations. State resets on reload — this is intentional and keeps the mock obviously throwaway.

Rejected alternatives:

- **localStorage persistence** — adds reset-button complexity and risks stale state confusing testers.
- **Stub Go handlers** — doubles the work for no demo benefit and locks in API shape prematurely.

## Sidebar entry & routing

A new sidebar item **"Cloud"** is added to `frontends/web/src/components/sidebar/sidebar.tsx`, positioned near the existing entries (next to Buy/Settings). It uses a cloud icon and routes to `/cloud`.

Routes:

```
/cloud                         dashboard (identity card + 2 tiles)
/cloud/contacts                address book list + inbox banner
/cloud/contacts/add            scan QR or paste handle
/cloud/contacts/:contactId     contact detail (actions + Messages/Activity tabs)
/cloud/tresor                  documents list
/cloud/tresor/new              create document
/cloud/tresor/:docId           view/edit document
```

The identity selector lives in a sticky header *inside* `/cloud/*` only — the rest of the app is unaffected.

## Dashboard (`/cloud`)

Three vertical zones:

**Zone 1 — Identity selector (sticky top).** Compact bar with avatar circle (deterministic gradient from pubkey), identity name, dropdown chevron. Click expands a menu listing the seeded identities ("Personal", "Family Savings"), each with handle preview.

**Zone 2 — Identity card.** Large rounded card. Left: QR code (~180px) encoding handle+pubkey. Right: word-handle in large type, truncated pubkey in mono, **Copy** and **Share** buttons. Footer line: *"Others can scan this to add you. Nothing is stored on a server until you add a contact."*

**Zone 3 — Two large feature tiles.** Hover-lifts, click navigates:

1. **Address book** — icon + "N contacts" subtitle.
2. **Tresor** — icon + "N documents" subtitle.

Payment requests and messaging are accessed via the address book (not as separate tiles).

## Address book

### List (`/cloud/contacts`)

- Top: slim **inbox banner** when pending requests or unread messages exist — e.g. *"2 pending payment requests · 1 unread message"*, expandable inline.
- Search field + **+ Add contact** button.
- List grouped into **My devices** and **People** subsections.
- Each row: avatar, name, handle in mono, right-side badges (red dot for unread; "$" for incoming request).

### Add contact (`/cloud/contacts/add`)

Two tabs: **Scan QR** (placeholder rectangle with "Use sample QR" demo button) and **Paste handle** (text input). Both lead to a confirmation card with resolved name/handle/pubkey, an editable Nickname field, and "Add to contacts."

### Detail (`/cloud/contacts/:id`)

- Top: avatar, nickname, handle, verified-pairing check icon (for seeded contacts), "..." menu (Rename, Remove).
- Action row, three buttons:
  - **Send BTC** — opens the existing send dialog pre-filled with the contact. The "address" field shows a faux BIP-47-derived address with a "via payment code" badge instead of being editable.
  - **Request payment** — dialog with amount (BTC/fiat toggle, reusing the existing amount input component) and memo. On submit, surfaces in Activity as "Sent · pending."
  - **Message** — focuses the Messages tab.
- Two tabs:
  - **Messages** — chat thread (right-aligned own bubbles, left-aligned theirs). Compose box at the bottom. End-to-end-encrypted reassurance line at the top.
  - **Activity** — chronological list of payment requests, sent/received BTC txs (link to existing tx detail page), contact-added event. Each item has a status pill.

## Tresor

### List (`/cloud/tresor`)

- Header: title + tagline *"Encrypted documents. Optionally released to chosen recipients if you stop checking in."*
- **+ New document** button.
- Body: a list of card-rows. Each card shows:
  - Lock icon (filled = sealed, outline = draft).
  - Title (semibold), one-line body preview, recipient avatar row (max 3 + "+N"), last-modified time.
  - Right-side status pill — **Draft**, **Sealed**, **At risk in N days** (closest timer), or **Released to {name}** for the demo-fired state.
- "..." menu: Rename, Duplicate, Delete.

### Create / Edit (`/cloud/tresor/new`, `/cloud/tresor/:id`)

Two-column layout (single column on narrow viewports):

**Left — Editor:**

- Title input (large, borderless).
- Body: plain `<textarea>` styled as a doc surface (no toolbar). Auto-saves draft to in-memory store on blur.

**Right — Recipients & timers (collapsible):**

- **+ Add recipient** opens a contact-picker modal.
- Each selected recipient: avatar, name, handle, an **Unlock delay** select (**Never** default / **30 days** / **90 days** / **1 year** / **Custom…**), help-tooltip *"{name} can decrypt if you don't check in with the cloud for this long."*, remove button.
- Aggregate footer line: *"Sealed for N recipients. Earliest release: M days of silence."*
- **Seal & save** primary button when there are ≥1 recipient and unsaved changes; idle state shows "Sealed · last updated …".

### View (`/cloud/tresor/:id`)

Same layout as edit but body renders read-only by default with an **Edit** button top-right. Recipients panel is read-only.

## Fake data

### Two seeded identities

```
Personal           handle: silver-otter-4821      pubkey: 02f3...c4a1
Family Savings     handle: copper-finch-9032      pubkey: 03ab...91e7
```

Default selection: Personal. Each identity has its own contacts/docs/messages/requests. Family Savings gets a sparser set so switching is visibly different.

### Contacts (under Personal)

*My devices:*

- **Family Savings** — `copper-finch-9032` (the user's other identity; auto-paired).
- **Travel BitBox** — `quiet-heron-1177`.

*People:*

- **Alice Reyes** — `bright-willow-3320` — spouse, paired, has unread message.
- **Bob Martens** — `amber-falcon-5512` — brother, has incoming payment request for 0.0042 BTC ("dinner split").
- **Carol Schmid** — `granite-lynx-2089` — lawyer.
- **Dave Okonkwo** — `nimble-fox-7704` — friend, one paid request in activity.

### Tresor docs (under Personal)

1. **Recovery instructions** — sealed. Recipients: Alice (30 days), Carol (90 days), Bob (1 year). Status pill: *At risk in 30 days*.
2. **For my family** — sealed, *demo-fired*. Recipients: Alice (released), Bob (90 days pending). Status pill: *Released to Alice · 3 days ago (demo)*.
3. **Misc notes** — draft, no recipients.

### Messages

Alice thread: 3-4 messages, latest from Alice unread: *"Got the payment, thanks! Dinner Saturday?"*

### Payment requests

- Incoming from Bob: 0.0042 BTC, "Dinner split", pending.
- Outgoing to Dave: 0.025 BTC, "Concert tickets", paid 2 days ago.

## State shape

```ts
type Identity = {
  id: string;
  name: string;
  handle: string;
  pubkey: string;
  avatarSeed: string;
};

type Contact = {
  id: string;
  identityId: string;
  name: string;
  handle: string;
  pubkey: string;
  kind: 'device' | 'person';
  pairedAt: number;
};

type TresorDoc = {
  id: string;
  identityId: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  recipients: {
    contactId: string;
    unlockDelayDays: number | null;
    releasedAt?: number;
  }[];
};

type Message = {
  id: string;
  identityId: string;
  contactId: string;
  from: 'me' | 'them';
  body: string;
  sentAt: number;
  readAt?: number;
};

type PaymentReq = {
  id: string;
  identityId: string;
  contactId: string;
  direction: 'in' | 'out';
  amountSats: number;
  memo: string;
  status: 'pending' | 'paid' | 'declined';
  createdAt: number;
};
```

`CloudMockContext` wraps `/cloud/*` and exposes:

- `currentIdentityId`, `setCurrentIdentityId`
- Selectors filtered by current identity: `contacts`, `docs`, `messages(contactId)`, `requests`.
- Mutations: `addContact`, `createDoc`, `updateDoc`, `sendMessage`, `markMessageRead`, `createRequest`, `markRequestPaid`, `markRequestDeclined`.

## File layout

```
frontends/web/src/routes/cloud/
  index.tsx                    dashboard
  cloud.module.css
  components/
    identity-selector.tsx
    identity-card.tsx
    feature-tile.tsx
    avatar.tsx                 deterministic gradient from pubkey
    qr.tsx                     thin wrapper over the existing QR component
  contacts/
    list.tsx
    detail.tsx
    add.tsx
    *.module.css
  tresor/
    list.tsx
    editor.tsx
    *.module.css
  state/
    context.tsx
    seed.ts
    types.ts
```

Router wired in `frontends/web/src/routes/router.tsx`. Sidebar updated in `frontends/web/src/components/sidebar/sidebar.tsx`. i18n strings added under a new `cloud.*` namespace in the English locale only.

## Decisions

- **Name:** "Cloud" (kept as-is for now; revisit later).
- **Username format:** word-based handle deterministic from pubkey.
- **Layout:** dashboard + drill-down with two feature tiles.
- **Send-to-contact:** BIP-47-style payment-code pairing (mocked as a non-editable address with a badge).
- **Tresor content:** rich text *displayed*, plain `<textarea>` *edited* (no rich-text editor for the mock).
- **Timer semantics:** unlock delay after silence; per-recipient; "Never" allowed.
- **Messaging surface:** inside contact detail, no top-level Messages tile.
- **Payment requests:** amount + memo, contact-targeted; surfaced in the contacts inbox banner and contact Activity tab.
- **Fidelity:** high-fidelity, clickable, with realistic family-and-friends seed including the user's own other devices as contacts.
- **Identity selector:** always visible; two identities seeded.
- **No reset button.** Reload restores seed.
- **QR library:** reuse the existing QR component (path to be confirmed during implementation).

## Risks

- Stakeholders mistake the mock for working software. Mitigation: a subtle dismissible *"Demo · no data is sent"* banner across the top of `/cloud/*`.
- The fired-timer demo state could mislead. Mitigation: the "Released to Alice" pill carries a *(demo)* suffix.

## Open items deferred to implementation

- Confirm path of the existing QR component and reuse.
- Confirm whether an existing rich-text component is worth reusing (default to `<textarea>` otherwise).
- Avatar gradient palette — small two-color linear gradient selection.
