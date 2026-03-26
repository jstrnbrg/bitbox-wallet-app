# Bitcoin Vaults v1

## Scope

Bitcoin Vaults add a new `Vault` account kind for:

- `btc`
- `tbtc`
- `rbtc`

Vaults are designed for a single owner controlling three BitBox02 devices. v1 supports one fixed policy only:

- native segwit multisig: `wsh(sortedmulti(2,...))`
- threshold: `2-of-3`
- derivation: `m/48'/coin'/account'/2'`

Vaults are always watch-only after creation or import.

## Why P2WSH

Vaults use `P2WSH` because it is the best privacy-preserving multisig format supported by current BitBox02 policy-wallet firmware in this app. The policy uses `sortedmulti`, so signer enrollment order does not affect:

- wallet identity
- descriptors
- derived addresses

## Account Model

Internally, Vaults are modeled as descriptor-based Bitcoin accounts.

The canonical account-level descriptor is the signing source of truth:

- `wsh(sortedmulti(2,[fp/path]xpub/<0;1>/*,...))`

That descriptor is stored in `backend/signing` as the Bitcoin signing configuration. The app then derives device-facing BitBox02 wallet policy data from it when needed. This avoids baking Vault-v1 fields like `threshold`, `participants`, or `accountKeypath` into the signing core and keeps the model extensible for future policy accounts.

Vault-specific app metadata lives outside the signing config:

- `policyId`
- account kind (`vault`)
- participant display names and setup draft state

`policyId` is derived from the canonical participant set and policy metadata. The account code format remains:

`v0-vault-{policyId}-{coinCode}-{accountNumber}`

## Setup Flow

Vault setup is a persisted local draft flow.

1. The user chooses a Bitcoin network, then selects `Vault`.
2. The app creates a local draft.
3. The user enrolls three BitBox02 devices one at a time.
4. Duplicate signers are rejected by root fingerprint.
5. After signer three is enrolled, the app canonicalizes the participant order and generates the recovery file.
6. The user must explicitly acknowledge the recovery export before completion.
7. The completed Vault is stored as a watch-only account and the draft is removed.

Drafts persist across restarts and can be resumed later.

## Recovery

The recovery export is mandatory because seed backups alone are not enough to reconstruct a fresh Vault host state. The recovery file contains:

- format/version metadata
- network
- canonical multipath descriptor
- threshold
- script type
- canonical participant metadata
- receive descriptor wildcard (`.../0/*`)
- change descriptor wildcard (`.../1/*`)

The canonical descriptor is authoritative on import. Participant metadata is validated against it, then the same watch-only Vault and `policyId` are recreated. Signers are registered lazily as they reconnect later.

## Signing Sessions

Vault sends do not use the single-sig `sendtx` path.

Instead, the app creates persisted signing sessions in the BTC account BoltDB. Each session stores:

- serialized PSBT
- tx summary
- note
- signer progress
- threshold
- timestamps
- broadcast txid once available

Session states:

- `draft`
- `partiallySigned`
- `readyToBroadcast`
- `broadcasted`
- `abandoned`

This allows one signature to be collected now and another later, including after app restart.

## Device Interaction

Vault device interaction uses BitBox02 policy-wallet support.

- firmware gating requires BitBox02 firmware with policy-wallet signing support
- registration is lazy on first secure interaction
- address verification and signing both derive policy script configs from the stored descriptor
- `ForceScriptConfig` is always supplied for Vault PSBT signing

## API Surface

### Vault setup

- `POST /vault-setup/start`
- `GET /vault-setup/drafts`
- `GET /vault-setup/{id}`
- `POST /vault-setup/{id}/enroll-signer`
- `GET /vault-setup/{id}/recovery-file`
- `POST /vault-setup/{id}/complete`
- `POST /vault-setup/{id}/discard`
- `POST /vault-import`

### Vault account actions

- `GET /account/{code}/recovery-file`
- `POST /account/{code}/signing-sessions`
- `GET /account/{code}/signing-sessions`
- `GET /account/{code}/signing-sessions/{id}`
- `POST /account/{code}/signing-sessions/{id}/sign`
- `POST /account/{code}/signing-sessions/{id}/broadcast`
- `POST /account/{code}/signing-sessions/{id}/abandon`

### Discovery

BTC-family discovery now advertises supported account kinds:

- `standard`
- `vault`

## Frontend Behavior

The web UI includes:

- a new account-type step in Bitcoin add-account flow
- a Vault create/import/resume wizard
- mandatory recovery export acknowledgment
- a dedicated `Vaults` section in sidebar and manage-accounts
- Vault account info with participant metadata and recovery export
- persisted signing sessions shown on Vault account pages
- Vault send flow that creates/signs sessions instead of immediately broadcasting

## Deliberately Deferred

These are intentionally out of scope for v1:

- collaborative multisig
- cloud sync
- non-BitBox02 cosigners
- alternate policies like `3-of-5`
- LTC Vaults
- hidden Vault discovery
- Taproot multisig
