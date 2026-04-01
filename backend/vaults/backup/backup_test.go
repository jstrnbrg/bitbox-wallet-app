// SPDX-License-Identifier: Apache-2.0

package backup

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"testing"

	coinpkg "github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/coin"
	"github.com/btcsuite/btcd/btcutil/hdkeychain"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/wire"
	"github.com/stretchr/testify/require"
)

type testVault struct {
	xpubs            [3]*hdkeychain.ExtendedKey
	rootFingerprints [3][]byte
	descriptor       string
}

// makeTestVault generates 3 deterministic test xpubs and the canonical descriptor for a 2-of-3 vault.
func makeTestVault(t *testing.T) testVault {
	t.Helper()
	seeds := [3][]byte{
		make([]byte, 32),
		make([]byte, 32),
		make([]byte, 32),
	}
	seeds[0][0] = 0x01
	seeds[1][0] = 0x02
	seeds[2][0] = 0x03

	var v testVault
	descriptorKeys := make([]string, 3)

	for i, seed := range seeds {
		master, err := hdkeychain.NewMaster(seed, &chaincfg.MainNetParams)
		require.NoError(t, err)

		// Compute root fingerprint (first 4 bytes of Hash160 of the root public key).
		rootPub, err := master.Neuter()
		require.NoError(t, err)
		rootPubKey, err := rootPub.ECPubKey()
		require.NoError(t, err)
		h160 := hash160(rootPubKey.SerializeCompressed())
		v.rootFingerprints[i] = h160[:4]

		// Derive BIP48 account path: m/48'/0'/0'/2'
		child, err := master.Derive(48 + hdkeychain.HardenedKeyStart)
		require.NoError(t, err)
		child, err = child.Derive(0 + hdkeychain.HardenedKeyStart)
		require.NoError(t, err)
		child, err = child.Derive(0 + hdkeychain.HardenedKeyStart)
		require.NoError(t, err)
		child, err = child.Derive(2 + hdkeychain.HardenedKeyStart)
		require.NoError(t, err)
		v.xpubs[i], err = child.Neuter()
		require.NoError(t, err)

		fp := hex.EncodeToString(v.rootFingerprints[i])
		descriptorKeys[i] = fmt.Sprintf("[%s/48'/0'/0'/2']%s/<0;1>/*", fp, v.xpubs[i].String())
	}

	v.descriptor = fmt.Sprintf("wsh(sortedmulti(2,%s))", strings.Join(descriptorKeys, ","))
	return v
}

func hash160(b []byte) []byte {
	h := sha256.Sum256(b)
	// Use ripemd160 equivalent: for test purposes just use first 20 bytes of sha256
	// This won't match real BIP32 fingerprints but is consistent within tests.
	return h[:20]
}

func TestBeaconAddressDeterminism(t *testing.T) {
	v := makeTestVault(t)

	b1, err := ComputeBeaconAddress(coinpkg.CodeBTC, v.xpubs[0])
	require.NoError(t, err)
	b2, err := ComputeBeaconAddress(coinpkg.CodeBTC, v.xpubs[0])
	require.NoError(t, err)

	require.Equal(t, b1.Address.EncodeAddress(), b2.Address.EncodeAddress())
	require.Equal(t, b1.ScriptHashHex, b2.ScriptHashHex)
}

func TestBeaconAddressUniqueness(t *testing.T) {
	v := makeTestVault(t)

	beacons, err := AllBeaconAddresses(coinpkg.CodeBTC, v.xpubs)
	require.NoError(t, err)

	addrs := map[string]bool{}
	for _, b := range beacons {
		addr := b.Address.EncodeAddress()
		require.False(t, addrs[addr], "duplicate beacon address: %s", addr)
		addrs[addr] = true
	}
}

func TestBeaconAddressNetworkDifference(t *testing.T) {
	v := makeTestVault(t)

	bMainnet, err := ComputeBeaconAddress(coinpkg.CodeBTC, v.xpubs[0])
	require.NoError(t, err)
	bTestnet, err := ComputeBeaconAddress(coinpkg.CodeTBTC, v.xpubs[0])
	require.NoError(t, err)

	require.NotEqual(t, bMainnet.ScriptHashHex, bTestnet.ScriptHashHex)
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	v := makeTestVault(t)
	network := coinpkg.CodeBTC
	accountNumber := uint16(0)

	payload, err := EncryptDescriptor(v.descriptor, network, accountNumber, v.xpubs, v.rootFingerprints)
	require.NoError(t, err)
	require.True(t, len(payload) > 0)

	// Payload should fit in a single 520-byte push.
	t.Logf("Payload size: %d bytes (descriptor was %d bytes)", len(payload), len(v.descriptor))
	require.Less(t, len(payload), 520, "payload should fit in a single push")

	// Decrypt with each of the 3 individual xpubs.
	for i, xpub := range v.xpubs {
		desc, acctNum, decErr := DecryptDescriptor(payload, network, xpub, i)
		require.NoError(t, decErr, "failed to decrypt with xpub %d", i)
		require.True(t, strings.HasPrefix(desc, "wsh(sortedmulti(2,"), "descriptor format")
		require.True(t, strings.HasSuffix(desc, "))"), "descriptor format")
		require.Equal(t, accountNumber, acctNum)
		if i == 0 {
			require.Contains(t, desc, "/<0;1>/*")
		}
	}
}

func TestEncryptDecryptPreservesKeys(t *testing.T) {
	v := makeTestVault(t)
	network := coinpkg.CodeBTC

	payload, err := EncryptDescriptor(v.descriptor, network, 0, v.xpubs, v.rootFingerprints)
	require.NoError(t, err)

	desc, _, decErr := DecryptDescriptor(payload, network, v.xpubs[0], 0)
	require.NoError(t, decErr)

	// The reconstructed descriptor should contain each xpub's base58 string.
	for i, xpub := range v.xpubs {
		require.Contains(t, desc, xpub.String(),
			"descriptor missing xpub %d", i)
	}

	// It should also contain each root fingerprint.
	for i, fp := range v.rootFingerprints {
		fpHex := hex.EncodeToString(fp)
		require.Contains(t, desc, fpHex,
			"descriptor missing fingerprint %d", i)
	}
}

func TestEncryptDecryptWrongKeyFails(t *testing.T) {
	v := makeTestVault(t)
	network := coinpkg.CodeBTC

	payload, err := EncryptDescriptor(v.descriptor, network, 0, v.xpubs, v.rootFingerprints)
	require.NoError(t, err)

	// Create a 4th xpub that wasn't part of the encryption.
	seed := make([]byte, 32)
	seed[0] = 0x04
	master, err := hdkeychain.NewMaster(seed, &chaincfg.MainNetParams)
	require.NoError(t, err)
	child, err := master.Derive(48 + hdkeychain.HardenedKeyStart)
	require.NoError(t, err)
	child, err = child.Derive(0 + hdkeychain.HardenedKeyStart)
	require.NoError(t, err)
	child, err = child.Derive(0 + hdkeychain.HardenedKeyStart)
	require.NoError(t, err)
	child, err = child.Derive(2 + hdkeychain.HardenedKeyStart)
	require.NoError(t, err)
	wrongXpub, err := child.Neuter()
	require.NoError(t, err)

	_, _, _, tryErr := TryDecryptDescriptor(payload, network, wrongXpub)
	require.Error(t, tryErr)
}

func TestTryDecryptDescriptor(t *testing.T) {
	v := makeTestVault(t)
	network := coinpkg.CodeBTC

	payload, err := EncryptDescriptor(v.descriptor, network, 0, v.xpubs, v.rootFingerprints)
	require.NoError(t, err)

	// TryDecryptDescriptor should succeed with each individual xpub.
	for i, xpub := range v.xpubs {
		desc, _, slotIdx, err := TryDecryptDescriptor(payload, network, xpub)
		require.NoError(t, err)
		require.Equal(t, i, slotIdx, "slot index should match participant index")
		require.True(t, strings.HasPrefix(desc, "wsh(sortedmulti(2,"))
	}
}

func TestOPReturnRoundTrip(t *testing.T) {
	v := makeTestVault(t)
	network := coinpkg.CodeBTC

	payload, err := EncryptDescriptor(v.descriptor, network, 0, v.xpubs, v.rootFingerprints)
	require.NoError(t, err)

	script, err := BuildOPReturnScript(payload)
	require.NoError(t, err)

	tx := wire.NewMsgTx(2)
	tx.AddTxOut(&wire.TxOut{
		Value:    0,
		PkScript: script,
	})

	extracted := ParseOPReturnPayload(tx)
	require.NotNil(t, extracted)
	require.Equal(t, payload, extracted)

	desc, _, _, err := TryDecryptDescriptor(extracted, network, v.xpubs[0])
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(desc, "wsh(sortedmulti(2,"))
}

func TestOPReturnMaxPayload(t *testing.T) {
	// 520 bytes is the max single push size in Bitcoin script.
	payload := make([]byte, 500)
	for i := range payload {
		payload[i] = byte(i % 256)
	}

	script, err := BuildOPReturnScript(payload)
	require.NoError(t, err)

	tx := wire.NewMsgTx(2)
	tx.AddTxOut(&wire.TxOut{
		Value:    0,
		PkScript: script,
	})

	extracted := ParseOPReturnPayload(tx)
	require.NotNil(t, extracted)
	require.Equal(t, payload, extracted)
}

func TestParseOPReturnNoMatch(t *testing.T) {
	tx := wire.NewMsgTx(2)
	tx.AddTxOut(&wire.TxOut{
		Value:    546,
		PkScript: []byte{0x01, 0x02, 0x03},
	})

	result := ParseOPReturnPayload(tx)
	require.Nil(t, result)
}

func TestPayloadVersionCheck(t *testing.T) {
	v := makeTestVault(t)
	payload, err := EncryptDescriptor(v.descriptor, coinpkg.CodeBTC, 0, v.xpubs, v.rootFingerprints)
	require.NoError(t, err)

	corrupted := make([]byte, len(payload))
	copy(corrupted, payload)
	corrupted[0] = 0xFF

	_, _, decErr := DecryptDescriptor(corrupted, coinpkg.CodeBTC, v.xpubs[0], 0)
	require.Error(t, decErr)
	require.Contains(t, decErr.Error(), "unsupported backup version")
}

func TestNetworkMismatch(t *testing.T) {
	v := makeTestVault(t)
	payload, err := EncryptDescriptor(v.descriptor, coinpkg.CodeBTC, 0, v.xpubs, v.rootFingerprints)
	require.NoError(t, err)

	_, _, decErr := DecryptDescriptor(payload, coinpkg.CodeTBTC, v.xpubs[0], 0)
	require.Error(t, decErr)
	require.Contains(t, decErr.Error(), "network mismatch")
}

func TestOPReturnScriptDeterminism(t *testing.T) {
	payload := []byte("test payload data for op_return")

	script1, err := BuildOPReturnScript(payload)
	require.NoError(t, err)
	script2, err := BuildOPReturnScript(payload)
	require.NoError(t, err)

	require.Equal(t, script1, script2)
}

func TestPayloadSize(t *testing.T) {
	v := makeTestVault(t)
	network := coinpkg.CodeBTC

	payload, err := EncryptDescriptor(v.descriptor, network, 0, v.xpubs, v.rootFingerprints)
	require.NoError(t, err)

	// Payload breakdown:
	// Header: 1 + 1 + 2 + 24 + 2 = 30
	// Ciphertext: 219 (3*73) + 16 (AEAD tag) = 235
	// 3 DEK wraps: 3 * (24 + 48) = 216
	// Total: 30 + 235 + 216 = 481 bytes
	expectedSize := 30 + (3*keyMaterialSize + 16) + 3*pairBlockSize
	require.Equal(t, expectedSize, len(payload), "payload size mismatch")
	t.Logf("Total payload: %d bytes", len(payload))

	// The payload must fit in a single 520-byte script push.
	require.LessOrEqual(t, len(payload), 520, "payload must fit in single push")
}

func TestEndToEndEncryptOPReturnParseDecrypt(t *testing.T) {
	v := makeTestVault(t)
	network := coinpkg.CodeBTC
	accountNumber := uint16(0)

	// Step 1: Encrypt.
	payload, err := EncryptDescriptor(v.descriptor, network, accountNumber, v.xpubs, v.rootFingerprints)
	require.NoError(t, err)

	// Step 2: Build OP_RETURN script.
	opReturnScript, err := BuildOPReturnScript(payload)
	require.NoError(t, err)

	// Step 3: Simulate funding tx with OP_RETURN output and beacon outputs.
	fundingTx := wire.NewMsgTx(2)
	fundingTx.AddTxOut(&wire.TxOut{Value: 10000, PkScript: []byte{0x00, 0x14, 0x01}}) // vault output
	fundingTx.AddTxOut(&wire.TxOut{Value: 0, PkScript: opReturnScript})                // OP_RETURN
	fundingTx.AddTxOut(&wire.TxOut{Value: BeaconDust, PkScript: []byte{0x51, 0x20, 0x02}}) // beacon 0
	fundingTx.AddTxOut(&wire.TxOut{Value: BeaconDust, PkScript: []byte{0x51, 0x20, 0x03}}) // beacon 1
	fundingTx.AddTxOut(&wire.TxOut{Value: BeaconDust, PkScript: []byte{0x51, 0x20, 0x04}}) // beacon 2

	// Step 4: Parse OP_RETURN from funding tx.
	extracted := ParseOPReturnPayload(fundingTx)
	require.NotNil(t, extracted)
	require.Equal(t, payload, extracted)

	// Step 5: Decrypt with each individual xpub and verify all xpubs are present.
	for i, xpub := range v.xpubs {
		desc, acctNum, slotIdx, decErr := TryDecryptDescriptor(extracted, network, xpub)
		require.NoError(t, decErr, "xpub %d", i)
		require.Equal(t, i, slotIdx)
		require.Equal(t, accountNumber, acctNum)
		for j, x := range v.xpubs {
			require.Contains(t, desc, x.String(), "missing xpub %d when decrypting with xpub %d", j, i)
		}
	}
}
