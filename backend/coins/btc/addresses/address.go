// SPDX-License-Identifier: Apache-2.0

package addresses

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"slices"

	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc/blockchain"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc/types"
	ourbtcutil "github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc/util"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/signing"
	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/txscript"
	"github.com/sirupsen/logrus"
)

// DerivedKey contains the derived public key and origin metadata for one address participant.
type DerivedKey struct {
	RootFingerprint []byte
	AbsoluteKeypath signing.AbsoluteKeypath
	PublicKey       *btcec.PublicKey
}

// AccountAddress models an address that belongs to an account of the user.
// It contains all the information needed to receive and spend funds.
type AccountAddress struct {
	btcutil.Address

	// AccountConfiguration is the account level configuration from which this address was derived.
	AccountConfiguration *signing.Configuration
	// PublicKey is the public key of a single-sig address.
	PublicKey   *btcec.PublicKey
	DerivedKeys []DerivedKey
	Derivation  types.Derivation

	// redeemScript stores the redeem script of a BIP16 P2SH output or nil if address type is not
	// P2SH.
	RedeemScript []byte
	// WitnessScript stores the witness script of a P2WSH output or nil otherwise.
	WitnessScript []byte

	log *logrus.Entry
}

// NewAccountAddress creates a new account address.
func NewAccountAddress(
	accountConfiguration *signing.Configuration,
	derivation types.Derivation,
	net *chaincfg.Params,
	log *logrus.Entry,
) *AccountAddress {

	log = log.WithFields(logrus.Fields{
		"accountConfiguration": accountConfiguration.String(),
		"change":               derivation.Change,
		"addressIndex":         derivation.AddressIndex,
	})
	log.Debug("Creating new account address")

	var address btcutil.Address
	var redeemScript []byte
	var witnessScript []byte
	var err error
	relativeKeypath := signing.NewEmptyRelativeKeypath().
		Child(derivation.SimpleChainIndex(), signing.NonHardened).
		Child(derivation.AddressIndex, signing.NonHardened)
	var publicKey *btcec.PublicKey
	var derivedKeys []DerivedKey
	if accountConfiguration.BitcoinDescriptor != nil {
		for _, keyInfo := range accountConfiguration.KeyInfos() {
			derivedXpub, err := relativeKeypath.Derive(keyInfo.ExtendedPublicKey)
			if err != nil {
				log.WithError(err).Panic("Failed to derive descriptor xpub.")
			}
			derivedPubKey, err := derivedXpub.ECPubKey()
			if err != nil {
				log.WithError(err).Panic("Failed to convert a descriptor xpub to a normal public key.")
			}
			derivedKeys = append(derivedKeys, DerivedKey{
				RootFingerprint: keyInfo.RootFingerprint,
				AbsoluteKeypath: keyInfo.AbsoluteKeypath.Append(relativeKeypath),
				PublicKey:       derivedPubKey,
			})
		}
		slices.SortFunc(derivedKeys, func(a, b DerivedKey) int {
			return bytes.Compare(
				a.PublicKey.SerializeCompressed(),
				b.PublicKey.SerializeCompressed(),
			)
		})
		builder := txscript.NewScriptBuilder().AddOp(txscript.OP_2)
		for _, derivedKey := range derivedKeys {
			builder.AddData(derivedKey.PublicKey.SerializeCompressed())
		}
		witnessScript, err = builder.AddOp(txscript.OP_3).AddOp(txscript.OP_CHECKMULTISIG).Script()
		if err != nil {
			log.WithError(err).Panic("Failed to build multisig witness script.")
		}
		witnessScriptHash := sha256.Sum256(witnessScript)
		address, err = btcutil.NewAddressWitnessScriptHash(witnessScriptHash[:], net)
		if err != nil {
			log.WithError(err).Panic("Failed to get p2wsh addr. from witness script.")
		}
	} else {
		derivedXpub, err := relativeKeypath.Derive(accountConfiguration.ExtendedPublicKey())
		if err != nil {
			log.WithError(err).Panic("Failed to derive xpub.")
		}
		publicKey, err = derivedXpub.ECPubKey()
		if err != nil {
			log.WithError(err).Panic("Failed to convert an extended public key to a normal public key.")
		}
		derivedKeys = []DerivedKey{{
			RootFingerprint: accountConfiguration.KeyInfos()[0].RootFingerprint,
			AbsoluteKeypath: accountConfiguration.AbsoluteKeypath().Append(relativeKeypath),
			PublicKey:       publicKey,
		}}
	}

	publicKeyHash := []byte(nil)
	if publicKey != nil {
		publicKeyHash = btcutil.Hash160(publicKey.SerializeCompressed())
	}
	switch accountConfiguration.ScriptType() {
	case signing.ScriptTypeP2PKH:
		address, err = btcutil.NewAddressPubKeyHash(publicKeyHash, net)
		if err != nil {
			log.WithError(err).Panic("Failed to get P2PKH addr. from public key hash.")
		}
	case signing.ScriptTypeP2WPKHP2SH:
		var segwitAddress *btcutil.AddressWitnessPubKeyHash
		segwitAddress, err = btcutil.NewAddressWitnessPubKeyHash(publicKeyHash, net)
		if err != nil {
			log.WithError(err).Panic("Failed to get p2wpkh-p2sh addr. from publ. key hash.")
		}
		redeemScript, err = txscript.PayToAddrScript(segwitAddress)
		if err != nil {
			log.WithError(err).Panic("Failed to get redeem script for segwit address.")
		}
		address, err = btcutil.NewAddressScriptHash(redeemScript, net)
		if err != nil {
			log.WithError(err).Panic("Failed to get a P2SH address for segwit.")
		}
	case signing.ScriptTypeP2WPKH:
		address, err = btcutil.NewAddressWitnessPubKeyHash(publicKeyHash, net)
		if err != nil {
			log.WithError(err).Panic("Failed to get p2wpkh addr. from publ. key hash.")
		}
	case signing.ScriptTypeP2TR:
		outputKey := txscript.ComputeTaprootKeyNoScript(publicKey)
		address, err = btcutil.NewAddressTaproot(schnorr.SerializePubKey(outputKey), net)
		if err != nil {
			log.WithError(err).Panic("Failed to get p2tr addr")
		}
	case signing.ScriptTypeP2WSH:
		// Already created above using the policy-derived witness script.
	default:
		log.Panic(fmt.Sprintf("Unrecognized script type: %s", accountConfiguration.ScriptType()))
	}

	return &AccountAddress{
		Address:              address,
		AccountConfiguration: accountConfiguration,
		PublicKey:            publicKey,
		DerivedKeys:          derivedKeys,
		Derivation:           derivation,
		RedeemScript:         redeemScript,
		WitnessScript:        witnessScript,
		log:                  log,
	}
}

// ID implements accounts.Address.
func (address *AccountAddress) ID() string {
	return string(address.PubkeyScriptHashHex())
}

// EncodeForHumans implements accounts.Address.
func (address *AccountAddress) EncodeForHumans() string {
	return address.EncodeAddress()
}

// AbsoluteKeypath implements accounts.Address.
func (address *AccountAddress) AbsoluteKeypath() signing.AbsoluteKeypath {
	return address.AccountConfiguration.AbsoluteKeypath().
		Child(address.Derivation.SimpleChainIndex(), false).
		Child(address.Derivation.AddressIndex, false)
}

// PubkeyScript returns the pubkey script of this address. Use this in a tx output to receive funds.
func (address *AccountAddress) PubkeyScript() []byte {
	script, err := ourbtcutil.PkScriptFromAddress(address.Address)
	if err != nil {
		address.log.WithError(err).Panic("Failed to get the pubkey script for an address.")
	}
	return script
}

// PubkeyScriptHashHex returns the hash of the pubkey script in hex format.
// It is used to subscribe to notifications at the ElectrumX server.
func (address *AccountAddress) PubkeyScriptHashHex() blockchain.ScriptHashHex {
	return blockchain.NewScriptHashHex(address.PubkeyScript())
}

// ScriptForHashToSign returns whether this address is a segwit output and the script used when
// calculating the hash to be signed in a transaction. This info is needed when trying to spend
// from this address.
func (address *AccountAddress) ScriptForHashToSign() (bool, []byte) {
	switch address.AccountConfiguration.ScriptType() {
	case signing.ScriptTypeP2PKH:
		return false, address.PubkeyScript()
	case signing.ScriptTypeP2WPKHP2SH:
		return true, address.RedeemScript
	case signing.ScriptTypeP2WPKH:
		return true, address.PubkeyScript()
	case signing.ScriptTypeP2WSH:
		return true, address.WitnessScript
	default:
		address.log.Panic("Unrecognized address type.")
	}
	panic("The end of the function cannot be reached.")
}
