// SPDX-License-Identifier: Apache-2.0

package signing

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/BitBoxSwiss/bitbox-wallet-app/util/errp"
	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcutil/hdkeychain"
)

// KeyInfo contains information about the key and where it is coming from.
type KeyInfo struct {
	// The root fingerprint is the first 32 bits of the hash160 of the pubkey at the keypath m/.
	// https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki#key-identifiers
	RootFingerprint   []byte
	AbsoluteKeypath   AbsoluteKeypath
	ExtendedPublicKey *hdkeychain.ExtendedKey
}

// NewKeyInfoFromString parses a descriptor key with origin information.
func NewKeyInfoFromString(key string) (*KeyInfo, error) {
	keyInfo := &KeyInfo{}
	xpubString := key

	if strings.HasPrefix(key, "[") {
		endIndex := strings.Index(key, "]")
		if endIndex == -1 {
			return nil, errp.New("malformed key origin - missing closing bracket")
		}
		origin := key[1:endIndex]
		xpubString = key[endIndex+1:]

		originParts := strings.SplitN(origin, "/", 2)
		if len(originParts) != 2 {
			return nil, errp.Newf("invalid origin format: %s", origin)
		}
		rootFingerprint, err := hex.DecodeString(originParts[0])
		if err != nil {
			return nil, errp.Wrap(err, "invalid fingerprint hex")
		}
		if len(rootFingerprint) != 4 {
			return nil, errp.New("root fingerprint must be 4 bytes (8 hex characters)")
		}
		keyInfo.RootFingerprint = rootFingerprint

		absoluteKeypath, err := NewAbsoluteKeypath("m/" + originParts[1])
		if err != nil {
			return nil, errp.Wrap(err, "invalid origin path")
		}
		keyInfo.AbsoluteKeypath = absoluteKeypath
	}

	if xpubString == "" {
		return nil, errp.New("missing extended public key")
	}
	extendedPublicKey, err := hdkeychain.NewKeyFromString(xpubString)
	if err != nil {
		return nil, errp.Wrap(err, "failed to parse extended key")
	}
	keyInfo.ExtendedPublicKey = extendedPublicKey
	return keyInfo, nil
}

func (ki KeyInfo) String() string {
	return fmt.Sprintf("keypath=%s", ki.AbsoluteKeypath.Encode())
}

func (ki KeyInfo) descriptorString() string {
	if ki.RootFingerprint == nil || ki.AbsoluteKeypath == nil {
		return ki.ExtendedPublicKey.String()
	}
	return fmt.Sprintf(
		"[%s/%s]%s",
		hex.EncodeToString(ki.RootFingerprint),
		strings.TrimPrefix(ki.AbsoluteKeypath.Encode(), "m/"),
		ki.ExtendedPublicKey.String(),
	)
}

type keyInfoEncoding struct {
	RootFingerprint string          `json:"rootFingerprint"`
	Keypath         AbsoluteKeypath `json:"keypath"`
	Xpub            string          `json:"xpub"`
}

// MarshalJSON implements json.Marshaler.
func (ki KeyInfo) MarshalJSON() ([]byte, error) {
	return json.Marshal(keyInfoEncoding{
		RootFingerprint: hex.EncodeToString(ki.RootFingerprint),
		Keypath:         ki.AbsoluteKeypath,
		Xpub:            ki.ExtendedPublicKey.String(),
	})
}

// UnmarshalJSON implements json.Unmarshaler.
func (ki *KeyInfo) UnmarshalJSON(bytes []byte) error {
	var encoding keyInfoEncoding
	if err := json.Unmarshal(bytes, &encoding); err != nil {
		return errp.Wrap(err, "Could not unmarshal KeyInfo")
	}
	rootFingerprint, err := hex.DecodeString(encoding.RootFingerprint)
	if err != nil {
		return errp.WithStack(err)
	}
	ki.RootFingerprint = rootFingerprint
	ki.AbsoluteKeypath = encoding.Keypath
	extendedPublicKey, err := hdkeychain.NewKeyFromString(encoding.Xpub)
	if err != nil {
		return errp.Wrap(err, "Could not read an extended public key.")
	}
	ki.ExtendedPublicKey = extendedPublicKey
	return nil
}

// BitcoinSimple represents a simple (single-signature) Bitcoin/Litecoin signing configuration.
type BitcoinSimple struct {
	KeyInfo    KeyInfo    `json:"keyInfo"`
	ScriptType ScriptType `json:"scriptType"`
}

// BitcoinPolicyParticipant contains vault participant metadata used by setup/recovery flows.
type BitcoinPolicyParticipant struct {
	KeyInfo KeyInfo `json:"keyInfo"`
	Name    string  `json:"name,omitempty"`
}

// BitcoinDescriptor represents a descriptor-based Bitcoin/Litecoin signing configuration.
type BitcoinDescriptor struct {
	Descriptor string `json:"descriptor"`
}

// BitcoinWalletPolicy is the BitBox02 policy-wallet representation derived from a descriptor.
type BitcoinWalletPolicy struct {
	Policy string
	Keys   []KeyInfo
}

// EthereumSimple represents a simple (standard single-sig, no exotic signing methods) Ethereum
// signing configuration.
type EthereumSimple struct {
	KeyInfo KeyInfo `json:"keyInfo"`
}

const descriptorMultipathSuffix = "/<0;1>/*"

var sortedmultiDescriptorRe = regexp.MustCompile(`^wsh\(sortedmulti\((\d+),(.+)\)\)$`)

func parseSortedmultiDescriptor(descriptor string) (int, []string, error) {
	match := sortedmultiDescriptorRe.FindStringSubmatch(descriptor)
	if len(match) != 3 {
		return 0, nil, errp.New("unsupported bitcoin descriptor")
	}
	threshold, err := strconv.Atoi(match[1])
	if err != nil {
		return 0, nil, errp.Wrap(err, "failed to parse descriptor threshold")
	}
	keyStrings := strings.Split(match[2], ",")
	if len(keyStrings) == 0 {
		return 0, nil, errp.New("descriptor is missing keys")
	}
	return threshold, keyStrings, nil
}

func descriptorBaseKey(key string) (string, error) {
	if !strings.HasSuffix(key, descriptorMultipathSuffix) {
		return "", errp.New("descriptor keys must use /<0;1>/* multipath derivation")
	}
	return strings.TrimSuffix(key, descriptorMultipathSuffix), nil
}

func (descriptor *BitcoinDescriptor) Threshold() (int, error) {
	threshold, _, err := parseSortedmultiDescriptor(descriptor.Descriptor)
	return threshold, err
}

func (descriptor *BitcoinDescriptor) KeyInfos() ([]KeyInfo, error) {
	_, keyStrings, err := parseSortedmultiDescriptor(descriptor.Descriptor)
	if err != nil {
		return nil, err
	}
	result := make([]KeyInfo, 0, len(keyStrings))
	for _, keyString := range keyStrings {
		baseKey, err := descriptorBaseKey(keyString)
		if err != nil {
			return nil, err
		}
		keyInfo, err := NewKeyInfoFromString(baseKey)
		if err != nil {
			return nil, err
		}
		result = append(result, *keyInfo)
	}
	return result, nil
}

func (descriptor *BitcoinDescriptor) AccountKeypath() (AbsoluteKeypath, error) {
	keyInfos, err := descriptor.KeyInfos()
	if err != nil {
		return nil, err
	}
	if len(keyInfos) == 0 {
		return nil, errp.New("descriptor is missing keys")
	}
	accountKeypath := keyInfos[0].AbsoluteKeypath
	if accountKeypath == nil {
		return nil, errp.New("descriptor key is missing origin info")
	}
	for _, keyInfo := range keyInfos[1:] {
		if !slices.Equal(accountKeypath.ToUInt32(), keyInfo.AbsoluteKeypath.ToUInt32()) {
			return nil, errp.New("descriptor keys do not share an account keypath")
		}
	}
	return accountKeypath, nil
}

func (descriptor *BitcoinDescriptor) ToWalletPolicy() (*BitcoinWalletPolicy, error) {
	threshold, keyStrings, err := parseSortedmultiDescriptor(descriptor.Descriptor)
	if err != nil {
		return nil, err
	}
	baseKeys := []string{}
	policyKeys := []string{}
	for _, keyString := range keyStrings {
		baseKey, err := descriptorBaseKey(keyString)
		if err != nil {
			return nil, err
		}
		keyIndex := slices.Index(baseKeys, baseKey)
		if keyIndex == -1 {
			keyIndex = len(baseKeys)
			baseKeys = append(baseKeys, baseKey)
		}
		policyKeys = append(policyKeys, fmt.Sprintf("@%d/**", keyIndex))
	}
	keyInfos := make([]KeyInfo, len(baseKeys))
	for i, key := range baseKeys {
		keyInfo, err := NewKeyInfoFromString(key)
		if err != nil {
			return nil, err
		}
		keyInfos[i] = *keyInfo
	}
	return &BitcoinWalletPolicy{
		Policy: fmt.Sprintf("wsh(sortedmulti(%d,%s))", threshold, strings.Join(policyKeys, ",")),
		Keys:   keyInfos,
	}, nil
}

func (walletPolicy *BitcoinWalletPolicy) FindKey(rootFingerprint []byte) (*KeyInfo, error) {
	for _, keyInfo := range walletPolicy.Keys {
		if bytes.Equal(keyInfo.RootFingerprint, rootFingerprint) {
			return &keyInfo, nil
		}
	}
	return nil, errp.New("could not find descriptor key")
}

func (descriptor *BitcoinDescriptor) RootFingerprints() ([][]byte, error) {
	keyInfos, err := descriptor.KeyInfos()
	if err != nil {
		return nil, err
	}
	result := make([][]byte, 0, len(keyInfos))
	for _, keyInfo := range keyInfos {
		if keyInfo.RootFingerprint != nil {
			result = append(result, keyInfo.RootFingerprint)
		}
	}
	if len(result) == 0 {
		return nil, errp.New("descriptor contains no root fingerprints")
	}
	return result, nil
}

// Configuration models a signing configuration.
type Configuration struct {
	// Poor man's union type: only one of the below can be non-nil.

	BitcoinSimple     *BitcoinSimple     `json:"bitcoinSimple,omitempty"`
	BitcoinDescriptor *BitcoinDescriptor `json:"bitcoinDescriptor,omitempty"`
	EthereumSimple    *EthereumSimple    `json:"ethereumSimple,omitempty"`
}

// NewBitcoinConfiguration creates a new configuration.
func NewBitcoinConfiguration(
	scriptType ScriptType,
	rootFingerprint []byte,
	absoluteKeypath AbsoluteKeypath,
	extendedPublicKey *hdkeychain.ExtendedKey,
) *Configuration {
	if extendedPublicKey.IsPrivate() {
		panic("An extended key is private! Only extended public keys are accepted.")
	}
	return &Configuration{
		BitcoinSimple: &BitcoinSimple{
			ScriptType: scriptType,
			KeyInfo: KeyInfo{
				RootFingerprint:   rootFingerprint,
				AbsoluteKeypath:   absoluteKeypath,
				ExtendedPublicKey: extendedPublicKey,
			},
		},
	}
}

// NewEthereumConfiguration creates a new configuration.
func NewEthereumConfiguration(
	rootFingerprint []byte,
	absoluteKeypath AbsoluteKeypath,
	extendedPublicKey *hdkeychain.ExtendedKey,
) *Configuration {
	if extendedPublicKey.IsPrivate() {
		panic("An extended key is private! Only extended public keys are accepted.")
	}
	return &Configuration{
		EthereumSimple: &EthereumSimple{
			KeyInfo{
				RootFingerprint:   rootFingerprint,
				AbsoluteKeypath:   absoluteKeypath,
				ExtendedPublicKey: extendedPublicKey,
			},
		},
	}
}

// NewBitcoinDescriptorConfiguration creates a new descriptor-based bitcoin configuration.
func NewBitcoinDescriptorConfiguration(descriptor string) (*Configuration, error) {
	cfg := &Configuration{
		BitcoinDescriptor: &BitcoinDescriptor{
			Descriptor: descriptor,
		},
	}
	if _, err := cfg.BitcoinDescriptor.KeyInfos(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// ScriptType returns the configuration's keypath.
func (configuration *Configuration) ScriptType() ScriptType {
	if configuration.BitcoinSimple != nil {
		return configuration.BitcoinSimple.ScriptType
	}
	if configuration.BitcoinDescriptor != nil {
		return ScriptTypeP2WSH
	}
	panic("ScriptType called on non-bitcoin configuration")
}

// AbsoluteKeypath returns the configuration's keypath.
func (configuration *Configuration) AbsoluteKeypath() AbsoluteKeypath {
	if configuration.BitcoinSimple != nil {
		return configuration.BitcoinSimple.KeyInfo.AbsoluteKeypath
	}
	if configuration.BitcoinDescriptor != nil {
		keypath, err := configuration.BitcoinDescriptor.AccountKeypath()
		if err == nil {
			return keypath
		}
		return nil
	}
	return configuration.EthereumSimple.KeyInfo.AbsoluteKeypath
}

// ExtendedPublicKey returns the configuration's extended public key.
func (configuration *Configuration) ExtendedPublicKey() *hdkeychain.ExtendedKey {
	if configuration.BitcoinSimple != nil {
		return configuration.BitcoinSimple.KeyInfo.ExtendedPublicKey
	}
	if configuration.BitcoinDescriptor != nil {
		keyInfos, err := configuration.BitcoinDescriptor.KeyInfos()
		if err == nil && len(keyInfos) > 0 {
			return keyInfos[0].ExtendedPublicKey
		}
		return nil
	}
	return configuration.EthereumSimple.KeyInfo.ExtendedPublicKey
}

// KeyInfos returns all key infos referenced by this configuration.
func (configuration *Configuration) KeyInfos() []KeyInfo {
	if configuration.BitcoinSimple != nil {
		return []KeyInfo{configuration.BitcoinSimple.KeyInfo}
	}
	if configuration.BitcoinDescriptor != nil {
		keyInfos, err := configuration.BitcoinDescriptor.KeyInfos()
		if err == nil {
			return keyInfos
		}
		return nil
	}
	return []KeyInfo{configuration.EthereumSimple.KeyInfo}
}

// RootFingerprints returns all root fingerprints referenced by this configuration.
func (configuration *Configuration) RootFingerprints() ([][]byte, error) {
	if configuration.BitcoinSimple != nil {
		return [][]byte{configuration.BitcoinSimple.KeyInfo.RootFingerprint}, nil
	}
	if configuration.BitcoinDescriptor != nil {
		return configuration.BitcoinDescriptor.RootFingerprints()
	}
	if configuration.EthereumSimple != nil {
		return [][]byte{configuration.EthereumSimple.KeyInfo.RootFingerprint}, nil
	}
	return nil, errp.New("could not retrieve fingerprints from signing configuration")
}

// Threshold returns the spending threshold of the configuration.
func (configuration *Configuration) Threshold() int {
	if configuration.BitcoinDescriptor != nil {
		threshold, err := configuration.BitcoinDescriptor.Threshold()
		if err == nil {
			return threshold
		}
	}
	return 1
}

// AccountNumber returns the account number as present in the BIP44 keypath.
// The configuration keypath must be a BIP44 keypath:
// m/purpose'/coin'/account' for Bitcoin-based coins.
// m/44'/coin'/0'/0/account for Ethereum.
// For invalid keypaths, zero is returned for the account number, along with an error.
func (configuration *Configuration) AccountNumber() (uint16, error) {
	if configuration.BitcoinSimple != nil {
		keypath := configuration.BitcoinSimple.KeyInfo.AbsoluteKeypath.ToUInt32()
		if len(keypath) != 3 || keypath[2] < hdkeychain.HardenedKeyStart {
			return 0, errp.Newf("unexpected bitcoin keypath: %v", keypath)
		}
		return uint16(keypath[2] - hdkeychain.HardenedKeyStart), nil
	}
	if configuration.BitcoinDescriptor != nil {
		keypath, err := configuration.BitcoinDescriptor.AccountKeypath()
		if err != nil {
			return 0, err
		}
		keypathUint32 := keypath.ToUInt32()
		if len(keypathUint32) != 4 ||
			keypathUint32[2] < hdkeychain.HardenedKeyStart ||
			keypathUint32[3] != 2+hdkeychain.HardenedKeyStart {
			return 0, errp.Newf("unexpected bitcoin descriptor keypath: %v", keypathUint32)
		}
		return uint16(keypathUint32[2] - hdkeychain.HardenedKeyStart), nil
	}
	if configuration.EthereumSimple != nil {
		keypath := configuration.EthereumSimple.KeyInfo.AbsoluteKeypath.ToUInt32()
		if len(keypath) != 5 || keypath[4] >= hdkeychain.HardenedKeyStart {
			return 0, errp.Newf("unexpected ethereum keypath: %v", keypath)
		}
		return uint16(keypath[4]), nil
	}
	return 0, errp.New("unknown signing configuration type")
}

// PublicKey returns the configuration's public key.
func (configuration *Configuration) PublicKey() *btcec.PublicKey {
	publicKey, err := configuration.ExtendedPublicKey().ECPubKey()
	if err != nil {
		panic("Failed to convert an extended public key to a normal public key.")
	}
	return publicKey
}

// String returns a short summary of the configuration to be used in logs, etc.
func (configuration *Configuration) String() string {
	if configuration.BitcoinSimple != nil {
		return fmt.Sprintf("bitcoinSimple;scriptType=%s;%s",
			configuration.BitcoinSimple.ScriptType, configuration.BitcoinSimple.KeyInfo)
	}
	if configuration.BitcoinDescriptor != nil {
		return fmt.Sprintf("bitcoinDescriptor;scriptType=%s", configuration.ScriptType())
	}
	return fmt.Sprintf("ethereumSimple;%s", configuration.EthereumSimple.KeyInfo)
}

// Configurations is an unordered collection of configurations. All entries must have the same root
// fingerprint.
type Configurations []*Configuration

// AccountNumber returns the first config's account number. It assumes all configurations have the
// same account number.
func (configs Configurations) AccountNumber() (uint16, error) {
	for _, config := range configs {
		return config.AccountNumber()
	}
	return 0, errp.New("no configs")
}

// RootFingerprint gets the fingerprint of the first config (assuming that all configurations have
// the same rootFingerprint). Returns an error if the list has no entries or does not contain a
// known config.
func (configs Configurations) RootFingerprint() ([]byte, error) {
	var fingerprint []byte
	for _, config := range configs {
		for _, keyInfo := range config.KeyInfos() {
			if fingerprint == nil {
				fingerprint = keyInfo.RootFingerprint
				continue
			}
			if !bytes.Equal(fingerprint, keyInfo.RootFingerprint) {
				return nil, errp.New("multiple root fingerprints in signing configurations")
			}
		}
	}
	if fingerprint == nil {
		return nil, errp.New("Could not retrieve fingerprint from signing configurations")
	}
	return fingerprint, nil
}

// RootFingerprints returns all root fingerprints referenced by the configurations.
func (configs Configurations) RootFingerprints() ([][]byte, error) {
	result := [][]byte{}
	for _, config := range configs {
		rootFingerprints, err := config.RootFingerprints()
		if err != nil {
			return nil, err
		}
		result = append(result, rootFingerprints...)
	}
	slices.SortFunc(result, bytes.Compare)
	result = slices.CompactFunc(result, bytes.Equal)
	return result, nil
}

// BitcoinDescriptor returns the single descriptor configuration if this is a descriptor account.
func (configs Configurations) BitcoinDescriptor() *BitcoinDescriptor {
	if len(configs) == 1 && configs[0].BitcoinDescriptor != nil {
		return configs[0].BitcoinDescriptor
	}
	return nil
}

// ContainsRootFingerprint returns true if the rootFingerprint is present in one of the configurations.
func (configs Configurations) ContainsRootFingerprint(rootFingerprint []byte) bool {
	for _, config := range configs {
		for _, keyInfo := range config.KeyInfos() {
			if bytes.Equal(keyInfo.RootFingerprint, rootFingerprint) {
				return true
			}
		}
	}
	return false
}

// FindScriptType returns the index of the first configuration that is a Bitcoin configuration
// and uses the provided script type. Returns -1 if none is found.
func (configs Configurations) FindScriptType(scriptType ScriptType) int {
	for idx, config := range configs {
		if (config.BitcoinSimple != nil || config.BitcoinDescriptor != nil) && config.ScriptType() == scriptType {
			return idx
		}
	}
	return -1
}
