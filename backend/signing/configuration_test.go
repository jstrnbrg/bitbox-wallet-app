// SPDX-License-Identifier: Apache-2.0

package signing

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/btcsuite/btcd/btcutil/hdkeychain"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/stretchr/testify/require"
)

func mustKeypath(keypath string) AbsoluteKeypath {
	kp, err := NewAbsoluteKeypath(keypath)
	if err != nil {
		panic(err)
	}
	return kp
}

func TestEncodeDecode(t *testing.T) {
	xpub, err := hdkeychain.NewMaster(make([]byte, 32), &chaincfg.TestNet3Params)
	require.NoError(t, err)
	xpub, err = xpub.Neuter()
	require.NoError(t, err)
	keypath := mustKeypath("m/84'/1'/0'")
	rootFingerprint := []byte{1, 2, 3, 4}

	cfg := NewBitcoinConfiguration(ScriptTypeP2WPKH, rootFingerprint, keypath, xpub)
	jsonBytes, err := json.Marshal(cfg)
	require.NoError(t, err)
	var cfgDecoded Configuration
	require.NoError(t, json.Unmarshal(jsonBytes, &cfgDecoded))
	require.Nil(t, cfgDecoded.EthereumSimple)
	require.NotNil(t, cfgDecoded.BitcoinSimple)
	require.Equal(t,
		cfg.BitcoinSimple.KeyInfo.RootFingerprint,
		cfgDecoded.BitcoinSimple.KeyInfo.RootFingerprint)
	require.Equal(t,
		cfg.BitcoinSimple.KeyInfo.ExtendedPublicKey.String(),
		cfgDecoded.BitcoinSimple.KeyInfo.ExtendedPublicKey.String())
	require.Equal(t,
		cfg.BitcoinSimple.KeyInfo.AbsoluteKeypath.Encode(),
		cfgDecoded.BitcoinSimple.KeyInfo.AbsoluteKeypath.Encode())

	cfg = NewEthereumConfiguration(rootFingerprint, keypath, xpub)
	jsonBytes, err = json.Marshal(cfg)
	require.NoError(t, err)
	var cfgDecodedEth Configuration
	require.NoError(t, json.Unmarshal(jsonBytes, &cfgDecodedEth))
	require.Nil(t, cfgDecodedEth.BitcoinSimple)
	require.NotNil(t, cfgDecodedEth.EthereumSimple)
	require.Equal(t,
		cfg.EthereumSimple.KeyInfo.RootFingerprint,
		cfgDecodedEth.EthereumSimple.KeyInfo.RootFingerprint)
	require.Equal(t,
		cfg.EthereumSimple.KeyInfo.ExtendedPublicKey.String(),
		cfgDecodedEth.EthereumSimple.KeyInfo.ExtendedPublicKey.String())
	require.Equal(t,
		cfg.EthereumSimple.KeyInfo.AbsoluteKeypath.Encode(),
		cfgDecodedEth.EthereumSimple.KeyInfo.AbsoluteKeypath.Encode())

	cfg, err = NewBitcoinDescriptorConfiguration(
		"wsh(sortedmulti(2," +
			"[01020304/48'/1'/7'/2']" + xpub.String() + "/<0;1>/*," +
			"[05060708/48'/1'/7'/2']" + xpub.String() + "/<0;1>/*," +
			"[090a0b0c/48'/1'/7'/2']" + xpub.String() + "/<0;1>/*))")
	require.NoError(t, err)
	jsonBytes, err = json.Marshal(cfg)
	require.NoError(t, err)
	var cfgDecodedDescriptor Configuration
	require.NoError(t, json.Unmarshal(jsonBytes, &cfgDecodedDescriptor))
	require.Nil(t, cfgDecodedDescriptor.BitcoinSimple)
	require.NotNil(t, cfgDecodedDescriptor.BitcoinDescriptor)
	require.Equal(t, cfg.BitcoinDescriptor.Descriptor, cfgDecodedDescriptor.BitcoinDescriptor.Descriptor)
}

func TestContainsRootFingerprint(t *testing.T) {
	xpub, err := hdkeychain.NewMaster(make([]byte, 32), &chaincfg.TestNet3Params)
	require.NoError(t, err)
	xpub, err = xpub.Neuter()
	require.NoError(t, err)
	keypath := mustKeypath("m/84'/1'/0'")
	configs := Configurations{
		NewBitcoinConfiguration(ScriptTypeP2WPKH, []byte{1, 2, 3, 4}, keypath, xpub),
		NewEthereumConfiguration([]byte{5, 6, 7, 8}, keypath, xpub),
	}
	require.False(t, configs.ContainsRootFingerprint([]byte{1, 1, 1, 1}))
	require.True(t, configs.ContainsRootFingerprint([]byte{1, 2, 3, 4}))
	require.True(t, configs.ContainsRootFingerprint([]byte{5, 6, 7, 8}))
}

func TestFindScriptType(t *testing.T) {
	xpub, err := hdkeychain.NewMaster(make([]byte, 32), &chaincfg.TestNet3Params)
	require.NoError(t, err)
	xpub, err = xpub.Neuter()
	require.NoError(t, err)
	keypath := mustKeypath("m/84'/1'/0'")
	configs := Configurations{
		NewBitcoinConfiguration(ScriptTypeP2WPKH, []byte{1, 2, 3, 4}, keypath, xpub),
		NewBitcoinConfiguration(ScriptTypeP2WPKHP2SH, []byte{1, 2, 3, 4}, keypath, xpub),
	}
	require.Equal(t, 0, configs.FindScriptType(ScriptTypeP2WPKH))
	require.Equal(t, 1, configs.FindScriptType(ScriptTypeP2WPKHP2SH))
	require.Equal(t, -1, configs.FindScriptType(ScriptTypeP2PKH))

	configs = Configurations{
		NewEthereumConfiguration([]byte{5, 6, 7, 8}, keypath, xpub),
	}
	require.Equal(t, -1, configs.FindScriptType(ScriptTypeP2WPKH))
}

func TestAccountNumber(t *testing.T) {
	xpub, err := hdkeychain.NewMaster(make([]byte, 32), &chaincfg.TestNet3Params)
	require.NoError(t, err)
	xpub, err = xpub.Neuter()
	require.NoError(t, err)
	rootFingerprint := []byte{1, 2, 3, 4}

	cfg := NewBitcoinConfiguration(
		ScriptTypeP2WPKH, rootFingerprint, mustKeypath("m/48'/0'/0'"), xpub)
	num, err := cfg.AccountNumber()
	require.NoError(t, err)
	require.Equal(t, uint16(0), num)
	cfg = NewBitcoinConfiguration(
		ScriptTypeP2WPKH, rootFingerprint, mustKeypath("m/48'/0'/10'"), xpub)
	num, err = cfg.AccountNumber()
	require.NoError(t, err)
	require.Equal(t, uint16(10), num)
	cfg = NewBitcoinConfiguration(
		ScriptTypeP2WPKH, rootFingerprint, mustKeypath("m/48'/0'/0'/10'"), xpub)
	num, err = cfg.AccountNumber()
	require.Error(t, err)
	require.Equal(t, uint16(0), num)

	cfg = NewEthereumConfiguration(
		rootFingerprint, mustKeypath("m/44'/60'/0'/0/0"), xpub)
	num, err = cfg.AccountNumber()
	require.NoError(t, err)
	require.Equal(t, uint16(0), num)
	cfg = NewEthereumConfiguration(
		rootFingerprint, mustKeypath("m/44'/60'/0'/0/10"), xpub)
	num, err = cfg.AccountNumber()
	require.NoError(t, err)
	require.Equal(t, uint16(10), num)
	cfg = NewEthereumConfiguration(
		rootFingerprint, mustKeypath("m/44'/60'/0'/0/0/10"), xpub)
	num, err = cfg.AccountNumber()
	require.Error(t, err)
	require.Equal(t, uint16(0), num)

	cfg, err = NewBitcoinDescriptorConfiguration(
		"wsh(sortedmulti(2," +
			"[01020304/48'/1'/7'/2']" + xpub.String() + "/<0;1>/*," +
			"[05060708/48'/1'/7'/2']" + xpub.String() + "/<0;1>/*," +
			"[090a0b0c/48'/1'/7'/2']" + xpub.String() + "/<0;1>/*))")
	require.NoError(t, err)
	num, err = cfg.AccountNumber()
	require.NoError(t, err)
	require.Equal(t, uint16(7), num)
}

func TestAccountNumberOnConfigurations(t *testing.T) {
	xpub, err := hdkeychain.NewMaster(make([]byte, 32), &chaincfg.TestNet3Params)
	require.NoError(t, err)
	xpub, err = xpub.Neuter()
	require.NoError(t, err)
	rootFingerprint := []byte{1, 2, 3, 4}

	cfg1 := NewBitcoinConfiguration(
		ScriptTypeP2WPKH, rootFingerprint, mustKeypath("m/48'/0'/10'"), xpub)
	cfg2 := NewBitcoinConfiguration(
		ScriptTypeP2WPKH, rootFingerprint, mustKeypath("m/84'/0'/10'"), xpub)
	cfgs := Configurations{cfg1, cfg2}
	num, err := cfgs.AccountNumber()
	require.NoError(t, err)
	require.Equal(t, uint16(10), num)
}

func TestNewKeyInfoFromString(t *testing.T) {
	validXpub := "xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL"

	t.Run("valid_with_origin", func(t *testing.T) {
		keyStr := "[d34db33f/44'/0'/0']" + validXpub
		keyInfo, err := NewKeyInfoFromString(keyStr)
		require.NoError(t, err)
		require.Equal(t, []byte{0xd3, 0x4d, 0xb3, 0x3f}, keyInfo.RootFingerprint)
		require.Equal(t, mustKeypath("m/44'/0'/0'"), keyInfo.AbsoluteKeypath)
		require.Equal(t, validXpub, keyInfo.ExtendedPublicKey.String())
	})

	t.Run("valid_without_origin", func(t *testing.T) {
		keyInfo, err := NewKeyInfoFromString(validXpub)
		require.NoError(t, err)
		require.Nil(t, keyInfo.RootFingerprint)
		require.Nil(t, keyInfo.AbsoluteKeypath)
		require.Equal(t, validXpub, keyInfo.ExtendedPublicKey.String())
	})

	t.Run("invalid", func(t *testing.T) {
		_, err := NewKeyInfoFromString("[zzzzzzzz/44'/0']invalid")
		require.Error(t, err)
	})
}

func TestBitcoinDescriptorToWalletPolicy(t *testing.T) {
	descriptor := &BitcoinDescriptor{
		Descriptor: "wsh(sortedmulti(2," +
			"[d34db33f/48'/1'/0'/2']xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/<0;1>/*," +
			"[aabbccdd/48'/1'/0'/2']xpub69H7F5d8KSRgmmdJg2KhpAK8SR3DjMwAdkxj3ZuxV27CprR9LgpeyGmXUbC6wb7ERfvrnKZjXoUmmDznezpbZb7ap6r1D3tgFxHmwMkQTPH/<0;1>/*," +
			"[01020304/48'/1'/0'/2']xpub6CmTSyYCHhv4XiddikeqRHtf1qFs34GTtgnYQ7KL7p6twKTduCjwGbgkZHY1bz2rnnib7sv2eFBDdLqEWzdmKr9MLPmndjx8vtx52x5ba5q/<0;1>/*))",
	}

	walletPolicy, err := descriptor.ToWalletPolicy()
	require.NoError(t, err)
	require.Equal(t, "wsh(sortedmulti(2,@0/**,@1/**,@2/**))", walletPolicy.Policy)
	require.Len(t, walletPolicy.Keys, 3)
	require.Equal(t, mustKeypath("m/48'/1'/0'/2'"), walletPolicy.Keys[0].AbsoluteKeypath)
	require.Equal(t, "xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL", walletPolicy.Keys[0].ExtendedPublicKey.String())
}

func TestDescriptorRootFingerprints(t *testing.T) {
	xpub, err := hdkeychain.NewMaster(make([]byte, 32), &chaincfg.TestNet3Params)
	require.NoError(t, err)
	xpub, err = xpub.Neuter()
	require.NoError(t, err)
	cfg, err := NewBitcoinDescriptorConfiguration(
		strings.Join([]string{
			"wsh(sortedmulti(2",
			"[01020304/48'/1'/1'/2']" + xpub.String() + "/<0;1>/*",
			"[05060708/48'/1'/1'/2']" + xpub.String() + "/<0;1>/*",
			"[090a0b0c/48'/1'/1'/2']" + xpub.String() + "/<0;1>/*))",
		}, ","))
	require.NoError(t, err)
	rootFingerprints, err := cfg.RootFingerprints()
	require.NoError(t, err)
	require.Len(t, rootFingerprints, 3)
	require.Equal(t, []byte{1, 2, 3, 4}, rootFingerprints[0])
}
