# On-Chain Vault Descriptor Backup

## Problem

A 2-of-3 multisig vault requires all 3 extended public keys (in the descriptor) to reconstruct addresses. Currently, users must keep a separate recovery file. If they lose it but still have 2 devices, funds are inaccessible. This is counterintuitive and dangerous.

## Solution

Encrypt the vault's key material and store it on the Bitcoin blockchain using an inscription-style transaction. During recovery, derive a deterministic "beacon" address from the 2 available xpubs, query the Electrum server for transactions to that address, and extract + decrypt the key material.

**No server infrastructure needed** -- standard Electrum queries suffice. No custom indexer, no full node.

## Design

### Beacon Address Scheme

For 3 participants (A, B, C in canonical order), there are 3 pairs: (A,B), (A,C), (B,C). Each pair gets a deterministic P2TR beacon address:

```
pair_hash = SHA256("bitbox-vault-beacon-v1" || 0x00 || network_byte || 0x00 || xpub_i_bytes || xpub_j_bytes)
internal_key = NUMS_point + pair_hash * G
beacon = P2TR(ComputeTaprootKeyNoScript(internal_key))
```

The xpubs are the account-level BIP48 keys (`m/48'/coin'/account'/2'`) already obtained during vault setup. Different account numbers produce different xpubs, so multiple vaults with the same signers never collide.

The beacon outputs are provably unspendable (NUMS-derived internal key) -- the dust is burned.

### Compact Key Material

Instead of encrypting the full descriptor string (~450 bytes), we only store the essential key material per participant:

| Field | Size |
|-------|------|
| Root fingerprint | 4 bytes |
| Parent fingerprint | 4 bytes |
| Compressed public key | 33 bytes |
| Chain code | 32 bytes |
| **Per key total** | **73 bytes** |
| **3 keys total** | **219 bytes** |

The descriptor template (`wsh(sortedmulti(2,...))`), derivation paths (`48'/coin'/account'/2'`), and multipath suffix (`/<0;1>/*`) are fixed for v1 vaults and reconstructed during decryption. This keeps the inscription small.

### Encryption

- Generate random 32-byte DEK (Data Encryption Key)
- Encrypt the 219-byte key material with XChaCha20-Poly1305 using the DEK
- Wrap the DEK 3 times (once per participant pair) using pair-specific keys:
  ```
  pair_ikm = SHA256(xpub_i_normalized || xpub_j_normalized)
  pair_key = HKDF-SHA256(ikm=pair_ikm, salt="bitbox-vault-dek-v1", info=network||account_number)
  wrapped_dek = XChaCha20-Poly1305(pair_key, random_nonce, DEK)
  ```
- During recovery: try decrypting each of the 3 wrapped DEK slots with the pair key derived from the 2 available xpubs. Exactly one succeeds (AEAD authentication rejects the others).

### On-Chain Payload Format

```
[1B version][1B network][2B account_num][24B main_nonce][2B ciphertext_len]
[235B ciphertext (219 + 16 AEAD tag)]
[24B nonce_AB][48B wrapped_DEK_AB]
[24B nonce_AC][48B wrapped_DEK_AC]
[24B nonce_BC][48B wrapped_DEK_BC]
```

**Total: 481 bytes** -- fits in a single 520-byte Bitcoin script data push.

### On-Chain Storage (Inscription-style Commit/Reveal)

**Commit tx**: Creates a taproot output whose script tree contains the encrypted payload:
```
Tapleaf script:
  OP_FALSE OP_IF
    <"bvb1">        // 4-byte protocol tag (bitbox vault backup v1)
    <481B payload>   // single push, fits within 520-byte limit
  OP_ENDIF
  OP_TRUE            // makes the script-path spendable

Internal key: NUMS (unspendable via key-path)
```

**Reveal tx**: Spends the commit output via script-path spend, which places the full tapleaf script (including the payload) in the transaction witness. Outputs pay dust (546 sats each) to all 3 beacon addresses.

### Cost

| Component | Size | Cost at 8 sat/vB |
|-----------|------|-------------------|
| Commit tx | ~152 vBytes | ~1,216 sats |
| Reveal tx | ~323 vBytes | ~2,584 sats |
| Beacon dust | 3 x 546 sats | 1,638 sats |
| **Total** | | **~5,438 sats** |

One-time cost for permanent, trustless, server-free vault recovery insurance.

### Recovery Flow

1. User opens BitBox App, navigates to "Recover Vault"
2. Connects 2 of 3 BitBox02 devices
3. App extracts account xpubs at `m/48'/coin'/account'/2'` from both devices
4. App computes the beacon address for this xpub pair
5. App queries Electrum: `ScriptHashGetHistory(beacon_scripthash)`
6. For each tx in history, fetches full tx via `TransactionGet(txhash)`
7. Parses witness data for `OP_FALSE OP_IF "bvb1" ...` inscription pattern
8. Decrypts key material using pair key derived from the 2 xpubs
9. Reconstructs the full descriptor from key material + known template
10. Creates a watch-only vault account from the reconstructed descriptor

Account number scanning (0..4) handles unknown account numbers -- at most 10 lightweight Electrum queries.

### Edge Cases

- **Beacon dust spent by someone**: Doesn't break recovery. `ScriptHashGetHistory` returns ALL transactions involving the script hash, including the reveal tx. The data lives in the reveal tx's input witness, not the beacon output.
- **Dust attack on beacon**: Unrelated txs won't contain the `"bvb1"` inscription pattern; silently skipped. Worst case: a few extra `TransactionGet` calls.
- **Commit confirmed but reveal not broadcast**: App persists commit txid locally and rebroadcasts reveal on restart.
- **Multiple vaults with same signers**: Different account numbers produce different BIP48 xpubs, so beacon addresses are naturally distinct.
- **Electrum server doesn't index the beacon**: Cannot happen -- Electrum protocol indexes all confirmed output scripts, and beacons are standard P2TR outputs.

## Comparison with multisig-backup/multisig-recovery

| | Josh Doman's approach | BitBox approach |
|---|---|---|
| Encryption | ChaCha20 + Shamir Secret Sharing | XChaCha20-Poly1305 + pairwise DEK wrapping |
| Storage | Ordinals inscription | Same (inscription-style commit/reveal) |
| Lookup | Custom indexing server + Bitcoin full node | Electrum `ScriptHashGetHistory` (no server) |
| Privacy index | 4-byte xfp pair hash | Deterministic P2TR beacon address |
| Server required | Yes (Node.js + full node) | **No** |
| Data size | ~500 bytes | **481 bytes** (single push) |

## Implementation

### New package: `backend/vaults/backup/`

| File | Purpose |
|------|---------|
| `beacon.go` | Beacon address derivation, HKDF key material |
| `encrypt.go` | Compact key serialization, encrypt/decrypt |
| `inscription.go` | Commit/reveal tx construction, witness parsing |
| `scan.go` | Electrum-based blockchain scanning |
| `crypto.go` | HMAC-SHA256 helper |
| `backup_test.go` | 16 unit tests |

### Dependencies

None new. All cryptographic primitives (`golang.org/x/crypto/chacha20poly1305`) and Bitcoin libraries (`btcsuite/btcd`) are already vendored.
