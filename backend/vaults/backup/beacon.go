// SPDX-License-Identifier: Apache-2.0

// Package backup implements on-chain vault descriptor backup and recovery.
//
// A 2-of-3 multisig vault descriptor contains all 3 extended public keys. Without it,
// even with 2 of 3 devices, funds cannot be recovered. This package encrypts the descriptor
// and stores it on the Bitcoin blockchain using an OP_RETURN transaction.
//
// For each participant, a deterministic P2TR "beacon" address is derived from their
// account-level xpub. During recovery, the user connects any single device, the app
// computes the beacon address for that participant, and queries the Electrum server for
// transactions to that address. The encrypted descriptor is extracted from the OP_RETURN
// output and decrypted using a key derived from that single xpub.
package backup

import (
	"crypto/sha256"
	"encoding/binary"

	coinpkg "github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/coin"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc/blockchain"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/errp"
	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/btcutil/hdkeychain"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/txscript"
)

const beaconDomain = "bitbox-vault-beacon-v1"

// networkByte maps coin codes to a stable byte for domain separation.
func networkByte(network coinpkg.Code) byte {
	switch network {
	case coinpkg.CodeBTC:
		return 0x00
	case coinpkg.CodeTBTC:
		return 0x01
	case coinpkg.CodeRBTC:
		return 0x02
	default:
		return 0xFF
	}
}

// NetParams returns the chaincfg.Params for a coin code.
func NetParams(network coinpkg.Code) *chaincfg.Params {
	switch network {
	case coinpkg.CodeBTC:
		return &chaincfg.MainNetParams
	case coinpkg.CodeTBTC:
		return &chaincfg.TestNet3Params
	case coinpkg.CodeRBTC:
		return &chaincfg.RegressionNetParams
	default:
		return &chaincfg.MainNetParams
	}
}

// BeaconResult contains a beacon address and its Electrum script hash for querying.
type BeaconResult struct {
	Address        btcutil.Address
	PkScript       []byte
	ScriptHashHex  blockchain.ScriptHashHex
	OutputKey      *btcec.PublicKey
	InternalKey    *btcec.PublicKey
}

// beaconHash computes the deterministic hash for a single xpub's beacon.
func beaconHash(network coinpkg.Code, xpub *hdkeychain.ExtendedKey) [32]byte {
	h := sha256.New()
	h.Write([]byte(beaconDomain))
	h.Write([]byte{0x00})
	h.Write([]byte{networkByte(network)})
	h.Write([]byte{0x00})

	// Use the raw 78-byte BIP32 serialization for determinism.
	h.Write(xpubSerializeNormalized(xpub))

	var result [32]byte
	copy(result[:], h.Sum(nil))
	return result
}

// numsInternalKey returns a Nothing-Up-My-Sleeve internal key.
// This is the standard BIP-341 NUMS point: the x-coordinate is SHA256("vault-beacon-nums").
// Since it's derived from a hash, nobody knows the discrete log, making it provably unspendable
// via key-path.
func numsInternalKey() *btcec.PublicKey {
	h := sha256.Sum256([]byte("vault-beacon-nums"))
	// Interpret the hash as a field element and find a point on the curve.
	// We use the ModNScalar approach: hash * G.
	var scalar btcec.ModNScalar
	scalar.SetByteSlice(h[:])
	var point btcec.JacobianPoint
	btcec.ScalarBaseMultNonConst(&scalar, &point)
	point.ToAffine()
	return btcec.NewPublicKey(&point.X, &point.Y)
}

// ComputeBeaconAddress derives a deterministic P2TR beacon address for a single xpub.
// The xpub should be the account-level BIP48 key (m/48'/coin'/account'/2').
func ComputeBeaconAddress(
	network coinpkg.Code,
	xpub *hdkeychain.ExtendedKey,
) (*BeaconResult, error) {
	// Derive the participant-specific internal key by tweaking the NUMS point with the beacon hash.
	bh := beaconHash(network, xpub)

	// Use beacon_hash as a tweak on the NUMS point to make each beacon unique.
	internal := numsInternalKey()

	// Tweak the NUMS internal key with the beacon hash to get a unique internal key per participant.
	var numsJ btcec.JacobianPoint
	internal.AsJacobian(&numsJ)
	var tweakScalar btcec.ModNScalar
	tweakScalar.SetBytes(&bh)
	var tweakPoint btcec.JacobianPoint
	btcec.ScalarBaseMultNonConst(&tweakScalar, &tweakPoint)
	var participantInternalKey btcec.JacobianPoint
	btcec.AddNonConst(&numsJ, &tweakPoint, &participantInternalKey)
	participantInternalKey.ToAffine()
	participantPubKey := btcec.NewPublicKey(&participantInternalKey.X, &participantInternalKey.Y)

	// ComputeTaprootKeyNoScript applies the standard BIP-341 taptweak with empty script root.
	outputKey := txscript.ComputeTaprootKeyNoScript(participantPubKey)

	net := NetParams(network)
	addr, err := btcutil.NewAddressTaproot(schnorr.SerializePubKey(outputKey), net)
	if err != nil {
		return nil, errp.Wrap(err, "failed to create beacon taproot address")
	}

	pkScript, err := txscript.PayToAddrScript(addr)
	if err != nil {
		return nil, errp.Wrap(err, "failed to create beacon pkScript")
	}

	return &BeaconResult{
		Address:       addr,
		PkScript:      pkScript,
		ScriptHashHex: blockchain.NewScriptHashHex(pkScript),
		OutputKey:     outputKey,
		InternalKey:   participantPubKey,
	}, nil
}

// AllBeaconAddresses computes beacon addresses for all 3 participants.
// xpubs must be in canonical order (3 elements).
// Returns one beacon per participant: [beacon_for_xpub0, beacon_for_xpub1, beacon_for_xpub2].
func AllBeaconAddresses(
	network coinpkg.Code,
	xpubs [3]*hdkeychain.ExtendedKey,
) ([3]*BeaconResult, error) {
	var results [3]*BeaconResult
	for i, xpub := range xpubs {
		result, err := ComputeBeaconAddress(network, xpub)
		if err != nil {
			return results, errp.Wrap(err, "failed to compute beacon address")
		}
		results[i] = result
	}
	return results, nil
}

// xpubSerializeNormalized returns a deterministic byte representation of an xpub
// regardless of which network version the key was originally encoded with.
// We normalize to mainnet version bytes and use the base58check string.
func xpubSerializeNormalized(xpub *hdkeychain.ExtendedKey) []byte {
	// BIP32 mainnet public version bytes
	mainnetVersion := []byte{0x04, 0x88, 0xb2, 0x1e}
	normalized, err := xpub.CloneWithVersion(mainnetVersion)
	if err != nil {
		// Should never fail for valid xpubs; panic to surface bugs.
		panic("CloneWithVersion failed: " + err.Error())
	}
	return []byte(normalized.String())
}

// KeyMaterial computes the key derivation input for a single participant's xpub.
// Used by both encryption and decryption.
func KeyMaterial(
	network coinpkg.Code,
	accountNumber uint16,
	xpub *hdkeychain.ExtendedKey,
) []byte {
	h := sha256.New()
	h.Write(xpubSerializeNormalized(xpub))
	ikm := h.Sum(nil)

	// HKDF-Extract: PRK = HMAC-SHA256(salt, IKM)
	salt := []byte("bitbox-vault-dek-v1")
	prk := hmacSHA256(salt, ikm)

	// HKDF-Expand: OKM = HMAC-SHA256(PRK, info || 0x01)
	var info [3]byte
	info[0] = networkByte(network)
	binary.BigEndian.PutUint16(info[1:3], accountNumber)
	expandInput := append(info[:], 0x01)
	return hmacSHA256(prk, expandInput)
}
