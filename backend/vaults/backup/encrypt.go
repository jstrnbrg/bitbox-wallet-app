// SPDX-License-Identifier: Apache-2.0

package backup

import (
	"encoding/binary"

	coinpkg "github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/coin"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/errp"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/random"
	"github.com/btcsuite/btcd/btcutil/hdkeychain"
	"golang.org/x/crypto/chacha20poly1305"
)

const (
	// PayloadVersion is the current on-chain backup format version.
	PayloadVersion = 0x01

	// Size constants for the encrypted payload.
	versionSize     = 1
	networkSize     = 1
	accountNumSize  = 2
	mainNonceSize   = chacha20poly1305.NonceSizeX // 24
	ciphertextLenSz = 2
	pairNonceSize   = chacha20poly1305.NonceSizeX // 24
	wrappedDEKSize  = 32 + chacha20poly1305.Overhead // 32 + 16 = 48
	numPairs        = 3
	numKeys         = 3

	// Per-key raw material: 4 bytes root fingerprint + 4 bytes parent fingerprint + 33 bytes compressed pubkey + 32 bytes chain code.
	keyMaterialSize = 4 + 4 + 33 + 32 // = 73

	// headerSize = version + network + accountNum + mainNonce + ciphertextLen
	headerSize = versionSize + networkSize + accountNumSize + mainNonceSize + ciphertextLenSz

	// pairBlockSize is the size of one pair's wrapped DEK entry (nonce + encrypted DEK).
	pairBlockSize = pairNonceSize + wrappedDEKSize
)

// serializeKeyMaterial packs the essential key data for 3 participants into a compact binary format.
// Per key: [4 bytes rootFingerprint][33 bytes compressed pubkey][32 bytes chaincode] = 69 bytes.
// Total: 207 bytes for 3 keys. The descriptor template, derivation paths, threshold etc.
// are fixed for v1 vaults and reconstructed during decryption.
func serializeKeyMaterial(
	xpubs [3]*hdkeychain.ExtendedKey,
	rootFingerprints [3][]byte,
) []byte {
	data := make([]byte, 0, numKeys*keyMaterialSize)
	for i := 0; i < numKeys; i++ {
		// Root fingerprint (4 bytes).
		fp := rootFingerprints[i]
		if len(fp) < 4 {
			fp = make([]byte, 4)
		}
		data = append(data, fp[:4]...)

		// Parent fingerprint (4 bytes) -- needed to reconstruct identical xpub strings.
		var parentFP [4]byte
		binary.BigEndian.PutUint32(parentFP[:], xpubs[i].ParentFingerprint())
		data = append(data, parentFP[:]...)

		// Compressed public key (33 bytes).
		pubKey, err := xpubs[i].ECPubKey()
		if err != nil {
			panic("failed to get EC public key from xpub: " + err.Error())
		}
		data = append(data, pubKey.SerializeCompressed()...)

		// Chain code (32 bytes).
		data = append(data, xpubs[i].ChainCode()...)
	}
	return data
}

// deserializeKeyMaterial unpacks compact key material back into xpubs and fingerprints.
// The xpubs are reconstructed as account-level keys at depth=4 with the appropriate network version.
func deserializeKeyMaterial(
	data []byte,
	network coinpkg.Code,
	accountNumber uint16,
) ([3]*hdkeychain.ExtendedKey, [3][]byte, error) {
	if len(data) != numKeys*keyMaterialSize {
		return [3]*hdkeychain.ExtendedKey{}, [3][]byte{}, errp.Newf(
			"invalid key material size: expected %d, got %d", numKeys*keyMaterialSize, len(data))
	}

	// Determine the HD key version bytes for this network.
	var version []byte
	switch network {
	case coinpkg.CodeBTC:
		version = []byte{0x04, 0x88, 0xb2, 0x1e} // xpub
	default:
		version = []byte{0x04, 0x35, 0x87, 0xcf} // tpub
	}

	// BIP48 account keypath child index: last component is 2' (script type).
	accountKeypath := BIP48AccountKeypathUint32(network, accountNumber)
	childIndex := accountKeypath[len(accountKeypath)-1]

	var xpubs [3]*hdkeychain.ExtendedKey
	var fingerprints [3][]byte

	for i := 0; i < numKeys; i++ {
		offset := i * keyMaterialSize
		fp := data[offset : offset+4]
		parentFP := data[offset+4 : offset+8]
		pubkey := data[offset+8 : offset+8+33]
		chaincode := data[offset+8+33 : offset+keyMaterialSize]

		fingerprints[i] = make([]byte, 4)
		copy(fingerprints[i], fp)

		// Reconstruct the extended key at depth 4 (m/48'/coin'/account'/2').
		xpubs[i] = hdkeychain.NewExtendedKey(
			version,
			pubkey,
			chaincode,
			parentFP,
			4, // depth: BIP48 account keys are at depth 4
			childIndex,
			false, // not private
		)
	}

	return xpubs, fingerprints, nil
}

// BIP48AccountKeypathUint32 returns the BIP48 account keypath as uint32 components.
func BIP48AccountKeypathUint32(network coinpkg.Code, accountNumber uint16) []uint32 {
	coinType := uint32(1)
	if network == coinpkg.CodeBTC {
		coinType = 0
	}
	return []uint32{
		48 + hdkeychain.HardenedKeyStart,
		coinType + hdkeychain.HardenedKeyStart,
		uint32(accountNumber) + hdkeychain.HardenedKeyStart,
		2 + hdkeychain.HardenedKeyStart,
	}
}

// EncryptDescriptor encrypts vault key material for on-chain storage.
// The xpubs and rootFingerprints must be in canonical order (3 elements each).
// Returns the binary payload ready for inscription.
//
// Instead of encrypting the full descriptor string (~455 bytes), we only encrypt
// the essential key material: root fingerprints, compressed pubkeys, and chain codes
// (~207 bytes). The descriptor template and derivation paths are fixed for v1 vaults
// and reconstructed during decryption. This keeps the inscription small (~400 vBytes).
func EncryptDescriptor(
	descriptor string,
	network coinpkg.Code,
	accountNumber uint16,
	xpubs [3]*hdkeychain.ExtendedKey,
	rootFingerprints [3][]byte,
) ([]byte, error) {
	plaintext := serializeKeyMaterial(xpubs, rootFingerprints)

	// Generate random Data Encryption Key.
	dek := random.BytesOrPanic(32)

	// Encrypt key material with XChaCha20-Poly1305 using the DEK.
	mainCipher, err := chacha20poly1305.NewX(dek)
	if err != nil {
		return nil, errp.Wrap(err, "failed to create main cipher")
	}
	mainNonce := random.BytesOrPanic(mainNonceSize)
	ciphertext := mainCipher.Seal(nil, mainNonce, plaintext, nil)

	if len(ciphertext) > 0xFFFF {
		return nil, errp.New("encrypted data too large for on-chain backup")
	}

	// Wrap the DEK 3 times, once per participant.
	var pairBlocks [numKeys][]byte
	for i := 0; i < numKeys; i++ {
		participantKey := KeyMaterial(network, accountNumber, xpubs[i])
		participantCipher, err := chacha20poly1305.NewX(participantKey)
		if err != nil {
			return nil, errp.Wrap(err, "failed to create participant cipher")
		}
		pairNonce := random.BytesOrPanic(pairNonceSize)
		wrappedDEK := participantCipher.Seal(nil, pairNonce, dek, nil)
		pairBlocks[i] = append(pairNonce, wrappedDEK...)
	}

	// Assemble the payload.
	payloadLen := headerSize + len(ciphertext) + numPairs*pairBlockSize
	payload := make([]byte, 0, payloadLen)

	// Header.
	payload = append(payload, PayloadVersion)
	payload = append(payload, networkByte(network))
	var accountNumBytes [2]byte
	binary.BigEndian.PutUint16(accountNumBytes[:], accountNumber)
	payload = append(payload, accountNumBytes[:]...)
	payload = append(payload, mainNonce...)
	var ctLenBytes [2]byte
	binary.BigEndian.PutUint16(ctLenBytes[:], uint16(len(ciphertext)))
	payload = append(payload, ctLenBytes[:]...)

	// Encrypted key material.
	payload = append(payload, ciphertext...)

	// Pair-wrapped DEKs.
	for _, block := range pairBlocks {
		payload = append(payload, block...)
	}

	return payload, nil
}

// DecryptDescriptor decrypts an on-chain backup payload using a single xpub.
// slotIndex is the index (0, 1, or 2) of the participant's slot in canonical order.
// Returns the reconstructed descriptor string and account number.
func DecryptDescriptor(
	payload []byte,
	network coinpkg.Code,
	xpub *hdkeychain.ExtendedKey,
	slotIndex int,
) (descriptor string, accountNumber uint16, err error) {
	if len(payload) < headerSize {
		return "", 0, errp.New("payload too short")
	}

	// Parse header.
	version := payload[0]
	if version != PayloadVersion {
		return "", 0, errp.Newf("unsupported backup version: %d", version)
	}

	payloadNetwork := payload[1]
	if payloadNetwork != networkByte(network) {
		return "", 0, errp.New("network mismatch in backup payload")
	}

	accountNumber = binary.BigEndian.Uint16(payload[2:4])

	mainNonce := payload[4 : 4+mainNonceSize]
	ctLen := int(binary.BigEndian.Uint16(payload[4+mainNonceSize : headerSize]))

	if len(payload) < headerSize+ctLen+numKeys*pairBlockSize {
		return "", 0, errp.New("payload truncated")
	}

	ciphertext := payload[headerSize : headerSize+ctLen]
	slotDataStart := headerSize + ctLen

	if slotIndex < 0 || slotIndex >= numKeys {
		return "", 0, errp.Newf("invalid slot index: %d", slotIndex)
	}

	// Unwrap the DEK from the matching slot.
	slotStart := slotDataStart + slotIndex*pairBlockSize
	slotNonce := payload[slotStart : slotStart+pairNonceSize]
	wrappedDEK := payload[slotStart+pairNonceSize : slotStart+pairBlockSize]

	participantKey := KeyMaterial(network, accountNumber, xpub)
	participantCipher, err := chacha20poly1305.NewX(participantKey)
	if err != nil {
		return "", 0, errp.Wrap(err, "failed to create participant cipher for decryption")
	}

	dek, err := participantCipher.Open(nil, slotNonce, wrappedDEK, nil)
	if err != nil {
		return "", 0, errp.Wrap(err, "failed to unwrap DEK - wrong key or corrupted data")
	}

	// Decrypt the key material.
	mainCipher, err := chacha20poly1305.NewX(dek)
	if err != nil {
		return "", 0, errp.Wrap(err, "failed to create main cipher for decryption")
	}

	plaintext, err := mainCipher.Open(nil, mainNonce, ciphertext, nil)
	if err != nil {
		return "", 0, errp.Wrap(err, "failed to decrypt key material")
	}

	// Reconstruct the descriptor from the key material.
	descriptor, err = reconstructDescriptor(plaintext, network, accountNumber)
	if err != nil {
		return "", 0, errp.Wrap(err, "failed to reconstruct descriptor from key material")
	}

	return descriptor, accountNumber, nil
}

// reconstructDescriptor rebuilds the full descriptor string from compact key material.
func reconstructDescriptor(keyMaterial []byte, network coinpkg.Code, accountNumber uint16) (string, error) {
	xpubs, fingerprints, err := deserializeKeyMaterial(keyMaterial, network, accountNumber)
	if err != nil {
		return "", err
	}

	// Build participant-style key strings and assemble the descriptor.
	// Format: wsh(sortedmulti(2,[fp/48'/coin'/account'/2']xpub/<0;1>/*,...))
	participants := make([]participantKey, numKeys)
	keypath := BIP48AccountKeypathUint32(network, accountNumber)
	for i := 0; i < numKeys; i++ {
		participants[i] = participantKey{
			rootFingerprint: fingerprints[i],
			keypath:         keypath,
			xpub:            xpubs[i],
		}
	}

	return buildDescriptor(participants), nil
}

// participantKey holds the data needed to format a descriptor key string.
type participantKey struct {
	rootFingerprint []byte
	keypath         []uint32
	xpub            *hdkeychain.ExtendedKey
}

// buildDescriptor formats a wsh(sortedmulti(2,...)) descriptor from participant keys.
func buildDescriptor(keys []participantKey) string {
	import_fmt := func() string { return "" } // placeholder to avoid import
	_ = import_fmt

	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = formatDescriptorKey(k)
	}
	return "wsh(sortedmulti(2," + joinStrings(parts, ",") + "))"
}

func formatDescriptorKey(k participantKey) string {
	fp := hexEncode(k.rootFingerprint)
	path := formatKeypath(k.keypath)
	return "[" + fp + "/" + path + "]" + k.xpub.String() + "/<0;1>/*"
}

func formatKeypath(components []uint32) string {
	parts := make([]string, len(components))
	for i, c := range components {
		if c >= hdkeychain.HardenedKeyStart {
			parts[i] = uintToString(c-hdkeychain.HardenedKeyStart) + "'"
		} else {
			parts[i] = uintToString(c)
		}
	}
	return joinStrings(parts, "/")
}

func hexEncode(b []byte) string {
	const hex = "0123456789abcdef"
	result := make([]byte, len(b)*2)
	for i, v := range b {
		result[i*2] = hex[v>>4]
		result[i*2+1] = hex[v&0x0f]
	}
	return string(result)
}

func uintToString(v uint32) string {
	if v == 0 {
		return "0"
	}
	buf := make([]byte, 0, 10)
	for v > 0 {
		buf = append(buf, byte('0'+v%10))
		v /= 10
	}
	// Reverse.
	for i, j := 0, len(buf)-1; i < j; i, j = i+1, j-1 {
		buf[i], buf[j] = buf[j], buf[i]
	}
	return string(buf)
}

func joinStrings(parts []string, sep string) string {
	if len(parts) == 0 {
		return ""
	}
	result := parts[0]
	for _, p := range parts[1:] {
		result += sep + p
	}
	return result
}

// TryDecryptDescriptor attempts to decrypt using each slot until one succeeds.
// This is useful during recovery when the caller doesn't know which slot index
// corresponds to the available xpub.
func TryDecryptDescriptor(
	payload []byte,
	network coinpkg.Code,
	xpub *hdkeychain.ExtendedKey,
) (descriptor string, accountNumber uint16, slotIdx int, err error) {
	// Try all 3 slots. Exactly one should succeed for a valid participant.
	for idx := 0; idx < numKeys; idx++ {
		desc, acctNum, tryErr := DecryptDescriptor(payload, network, xpub, idx)
		if tryErr == nil {
			return desc, acctNum, idx, nil
		}
	}
	return "", 0, -1, errp.New("failed to decrypt with any slot - xpub may not belong to this backup")
}
