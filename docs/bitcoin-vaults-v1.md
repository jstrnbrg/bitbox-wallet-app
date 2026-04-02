# Bitcoin Vaults v1

## Overview

Bitcoin Vaults add a new `vault` account kind for `btc`, `tbtc`, and `rbtc`. A vault is a 2-of-3 multisig Bitcoin wallet (P2WSH) designed for a single owner controlling three BitBox02 devices. The vault descriptor is encrypted and stored on-chain via an OP_RETURN output, allowing any single participant device to discover and restore the vault from the blockchain without a recovery file. Spending requires 2-of-3 signatures.

v1 supports one fixed policy:

- Native segwit multisig: `wsh(sortedmulti(2,...))`
- Threshold: 2-of-3
- Derivation: `m/48'/coin'/account'/2'`
- Script type: P2WSH

Vaults are always watch-only after creation or import.

## Why P2WSH

Vaults use P2WSH because it is the best privacy-preserving multisig format supported by current BitBox02 policy-wallet firmware. The policy uses `sortedmulti`, so signer enrollment order does not affect wallet identity, descriptors, or derived addresses.

## Account Model

Vaults are modeled as descriptor-based Bitcoin accounts. The canonical account-level descriptor is the signing source of truth:

```
wsh(sortedmulti(2,[fp/path]xpub/<0;1>/*,...))
```

This descriptor is stored in `backend/signing` as the Bitcoin signing configuration. The app derives device-facing BitBox02 wallet policy data from it when needed. This avoids baking vault-specific fields like `threshold`, `participants`, or `accountKeypath` into the signing core and keeps the model extensible.

Vault-specific app metadata lives outside the signing config:

- `policyId` — SHA256 hash (64 hex chars) over `network || policy || threshold || scriptType || keypath || participants`
- Account kind (`vault`)
- Participant display names and setup draft state

Account code format: `v0-vault-{policyId}-{coinCode}-{accountNumber}`

## Participants & Ordering

Each vault has exactly 3 participants, each identified by a BIP48 extended public key at keypath `m/48'/coin'/account'/2'`. Participants are canonicalized by sorting on:

```
hex(rootFingerprint) | absoluteKeypath | xpubString
```

This ensures the same 3 devices always produce the same canonical ordering regardless of enrollment order.

## Setup Flow

Vault setup is a persisted local draft flow.

1. The user chooses a Bitcoin network, then selects `Vault`.
2. The app creates a local draft in `collectingSigners` state.
3. The user enrolls three BitBox02 devices.
4. Duplicate signers are rejected by root fingerprint.
5. After signer three, the app canonicalizes participants and generates the recovery file. Draft moves to `readyForBackup`.
6. The user must explicitly acknowledge the recovery export before completion.
7. `CompleteVaultSetup` persists the vault as a watch-only account and removes the draft.

Draft states: `collectingSigners` → `readyForBackup` → `readyToComplete` → `completed` (or `discarded`). Drafts persist across restarts and can be resumed.

## On-Chain Descriptor Backup

The vault descriptor is too large to memorize and too critical to lose. Without it, even with 2 of 3 devices, funds cannot be recovered. The descriptor is encrypted and stored on-chain in the vault's first funding transaction.

**No server infrastructure needed** — standard Electrum `scripthash.get_history` queries suffice. No custom indexer, no full node.

### Beacon Addresses

Each participant gets a deterministic P2TR beacon address derived from their individual xpub:

```
beacon_hash = SHA256("bitbox-vault-beacon-v1" || 0x00 || network_byte || 0x00 || xpub_normalized)
internal_key = NUMS_point + beacon_hash * G
output_key = taptweak(internal_key, empty_script_root)
beacon_address = P2TR(output_key)
```

- **NUMS point:** `SHA256("vault-beacon-nums") * G` — provably unspendable via key-path.
- **xpub normalization:** Mainnet version bytes (`0x0488b21e`) applied before serialization, ensuring determinism across networks.
- **Network byte:** `0x00` (BTC), `0x01` (TBTC), `0x02` (RBTC).
- **Per-participant beacons:** One beacon per participant (not per pair). Scales linearly for future N-of-M policies.

The funding transaction sends 330 sats (taproot dust threshold) to each of the 3 beacon addresses. The beacon outputs are provably unspendable — the dust is burned.

### Compact Key Material

Instead of encrypting the full descriptor string (~450 bytes), only essential key material is stored:

| Field | Size |
|-------|------|
| Root fingerprint | 4 bytes |
| Parent fingerprint | 4 bytes |
| Compressed public key | 33 bytes |
| Chain code | 32 bytes |
| **Per key total** | **73 bytes** |
| **3 keys total** | **219 bytes** |

The descriptor template (`wsh(sortedmulti(2,...))`), derivation paths (`48'/coin'/account'/2'`), and multipath suffix (`/<0;1>/*`) are fixed for v1 vaults and reconstructed during decryption.

### Encryption

Two-layer scheme:

1. **Inner layer:** Key material (219 bytes) encrypted with a random 32-byte DEK using XChaCha20-Poly1305.
2. **Outer layer:** The DEK is wrapped 3 times (once per participant) using participant-specific keys:

```
IKM = SHA256(xpub_normalized)
PRK = HMAC-SHA256("bitbox-vault-dek-v1", IKM)
participant_key = HMAC-SHA256(PRK, network_byte || account_number || 0x01)
wrapped_dek = XChaCha20-Poly1305(participant_key, random_nonce, DEK)
```

Any single participant's xpub can unwrap the DEK and decrypt the full descriptor. This is a deliberate design choice: discovery and decryption require only one device. Spending security (2-of-3 threshold signatures) is enforced at the signing layer, not the encryption layer.

### Payload Wire Format

```
+--------+--------+-----------+------------+---------+
| Header (30 bytes)                                   |
+--------+--------+-----------+------------+---------+
| ver(1) | net(1) | acct#(2)  | nonce(24)  | ctlen(2)|
+--------+--------+-----------+------------+---------+
| Ciphertext (variable, typically 235 bytes)          |
| XChaCha20-Poly1305(DEK, nonce, key_material)        |
+---------+---------+---------+
| Slot 0 (72 bytes)           |  participant 0
| nonce(24) | wrapped_DEK(48) |
+---------+---------+---------+
| Slot 1 (72 bytes)           |  participant 1
| nonce(24) | wrapped_DEK(48) |
+---------+---------+---------+
| Slot 2 (72 bytes)           |  participant 2
| nonce(24) | wrapped_DEK(48) |
+---------+---------+---------+
```

**Total: 481 bytes** — fits in a single 520-byte Bitcoin script push.

### OP_RETURN Script

```
OP_RETURN <"bvb1" || encrypted_payload>
```

- **Protocol tag:** `bvb1` (4 ASCII bytes) — identifies BitBox vault backups.
- **Single data push:** Tag and payload are concatenated into one push (BitBox02 firmware constraint: only one data push supported after OP_RETURN).

## Funding Transaction

The vault's first transaction is a funding tx from a standard BTC account:

| Output | Value | Purpose |
|--------|-------|---------|
| Vault receive address | User-specified amount | Actual vault funds |
| OP_RETURN | 0 sats | Encrypted descriptor backup |
| Beacon 0 (P2TR) | 330 sats | Discovery for participant 0 |
| Beacon 1 (P2TR) | 330 sats | Discovery for participant 1 |
| Beacon 2 (P2TR) | 330 sats | Discovery for participant 2 |
| Change (if any) | Remainder | Back to source account |

The beacon outputs and OP_RETURN are injected as `AdditionalOutputs` in the transaction proposal. Their value and weight are included in coin selection and fee estimation.

### Cost

| Component | Size | Cost at 8 sat/vB |
|-----------|------|-------------------|
| Funding tx overhead | ~200 vBytes | ~1,600 sats |
| Beacon dust | 3 x 330 sats | 990 sats |
| **Total overhead** | | **~2,590 sats** |

One-time cost for permanent, trustless, server-free vault recovery insurance. The OP_RETURN approach is simpler and cheaper than commit/reveal inscription (single tx, no reveal).

## Discovery & Recovery

### Automatic Discovery

When a keystore is connected (`registerKeystore`), `maybeDiscoverVaults` runs as a background goroutine:

1. For each BTC coin code (BTC/TBTC/RBTC depending on mode):
2. For account numbers 0 through 4 (`MaxAccountScan`):
   - Derive BIP48 xpub from the connected keystore
   - Compute beacon address for that xpub
   - Query Electrum for transaction history at the beacon
   - If no history: stop scanning (gap limit)
   - If history found: parse OP_RETURN, decrypt descriptor, reconstruct recovery file, import vault
3. Already-known vaults are silently skipped (`errAccountAlreadyExists`).

Plugging in any one of the 3 devices on a fresh install automatically restores all funded vaults.

### Manual Recovery

Two paths:

1. **On-chain:** `RecoverVaultFromChain(blockchain, network, xpub, name)` — scans beacon for a single xpub, decrypts, and imports.
2. **File-based:** `ImportVaultRecovery(recoveryFile, name)` — imports from a JSON recovery file exported during setup.

### Edge Cases

- **Beacon dust spent by someone:** Doesn't break recovery. `ScriptHashGetHistory` returns all transactions involving the script hash, including the original funding tx.
- **Dust attack on beacon:** Unrelated txs won't contain a valid `"bvb1"` OP_RETURN payload; silently skipped.
- **Multiple vaults with same signers:** Different account numbers produce different BIP48 xpubs, so beacon addresses are naturally distinct.

## Signing Sessions

Vault sends do not use the single-sig `sendtx` path. The app creates persisted signing sessions in the BTC account transaction database. Each session stores:

- Serialized PSBT
- Transaction summary (recipient, amount, fee)
- Note
- Signer progress (`signedBy`, `missingSigners`)
- Threshold
- Timestamps
- Broadcast txid once available

Session states: `draft` → `partiallySigned` → `readyToBroadcast` → `broadcasted` (or `abandoned`).

This allows one signature to be collected now and another later, including after app restart.

## Device Interaction

Vault device interaction uses BitBox02 policy-wallet support.

- Firmware gating requires BitBox02 firmware with policy-wallet signing support.
- Registration is lazy on first secure interaction.
- Address verification and signing derive policy script configs from the stored descriptor.
- `ForceScriptConfig` is always supplied for vault PSBT signing.

## Recovery File Format

The recovery export contains everything needed to reconstruct a vault without on-chain data:

```json
{
  "format": "bitbox-vault-recovery-v1",
  "network": "btc",
  "policy": "wsh(sortedmulti(2,@0,@1,@2))",
  "descriptor": "wsh(sortedmulti(2,[fp/path]xpub/<0;1>/*,...))",
  "threshold": 2,
  "scriptType": "p2wsh",
  "policyId": "...",
  "accountNumber": 0,
  "accountKeypath": "m/48'/0'/0'/2'",
  "participants": [...],
  "descriptors": {
    "receive": "wsh(sortedmulti(2,...,0/*))",
    "change": "wsh(sortedmulti(2,...,1/*))"
  }
}
```

The canonical descriptor is authoritative on import. Participant metadata is validated against it, then the same watch-only vault and policy ID are recreated.

## Security Properties

| Property | Guarantee |
|----------|-----------|
| **Spending security** | 2-of-3 threshold signatures required. On-chain backup does not weaken this. |
| **Discovery** | Any single device can find the vault on-chain via its beacon address. |
| **Decryption** | Any single device can decrypt the descriptor from the OP_RETURN payload. |
| **Privacy tradeoff** | A compromised single device reveals vault structure and balances, but cannot spend. |
| **No custom indexer** | Discovery uses standard Electrum `scripthash.get_history` queries. |
| **Determinism** | All beacon addresses and encryption keys are deterministically derived from xpubs. |

## API Surface

### Vault Setup

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/vault-setup/start` | Create draft |
| GET | `/vault-setup/drafts` | List drafts |
| GET | `/vault-setup/{id}` | Get draft |
| POST | `/vault-setup/{id}/enroll-signer` | Enroll connected keystore |
| GET | `/vault-setup/{id}/recovery-file` | Export recovery file |
| POST | `/vault-setup/{id}/complete` | Finalize vault |
| POST | `/vault-setup/{id}/discard` | Discard draft |
| GET | `/vault-setup/{id}/onchain-backup-payload` | Get encrypted payload |
| GET | `/vault-setup/{id}/onchain-backup-beacons` | Get beacon addresses |

### Vault Import

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/vault-import` | Import from recovery file |

### Fund Vault

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/fund-vault/eligible-accounts/{vaultCode}` | List funding sources |
| POST | `/fund-vault/propose` | Create funding tx proposal |
| POST | `/fund-vault/send` | Broadcast funding tx |

### Per-Account (scoped to `/account/{code}`)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/recovery-file` | Export recovery file |
| GET | `/vault-inscription-status` | Backup status (found/confirmed/txid) |
| POST | `/signing-sessions` | Create signing session |
| GET | `/signing-sessions` | List sessions |
| GET | `/signing-sessions/{id}` | Get session |
| POST | `/signing-sessions/{id}/sign` | Sign with connected keystore |
| POST | `/signing-sessions/{id}/broadcast` | Broadcast fully signed tx |
| POST | `/signing-sessions/{id}/abandon` | Abandon session |

## File Reference

| File | Purpose |
|------|---------|
| `backend/vaults/vaults.go` | Types, participant ordering, policy computation, descriptor format |
| `backend/vaults/backup/beacon.go` | Per-xpub beacon derivation, HKDF key material |
| `backend/vaults/backup/encrypt.go` | Encryption/decryption, payload serialization, descriptor reconstruction |
| `backend/vaults/backup/inscription.go` | OP_RETURN script building/parsing, `bvb1` protocol tag |
| `backend/vaults/backup/scan.go` | Blockchain scanning, backup existence checks |
| `backend/vaults/backup/crypto.go` | HMAC-SHA256 helper |
| `backend/vaults_backend.go` | Setup, funding, discovery, recovery, import/export |
| `backend/coins/btc/maketx/maketx.go` | Transaction building with additional outputs |
| `backend/coins/btc/account.go` | `CheckVaultInscription` for backup status |
| `backend/coins/btc/signing_sessions.go` | Signing session lifecycle |

## Deliberately Deferred

Out of scope for v1:

- Collaborative multisig (multiple owners)
- Cloud sync
- Non-BitBox02 cosigners
- Alternate policies (e.g. 3-of-5)
- LTC vaults
- Taproot multisig
