// SPDX-License-Identifier: Apache-2.0

package btc

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"testing"

	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/accounts"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc/addresses"
	addressesTest "github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc/addresses/test"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc/blockchain"
	blockchainMock "github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc/blockchain/mocks"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc/maketx"
	coinpkg "github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/coin"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/config"
	keystorePkg "github.com/BitBoxSwiss/bitbox-wallet-app/backend/keystore"
	keystoremock "github.com/BitBoxSwiss/bitbox-wallet-app/backend/keystore/mocks"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/signing"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/vaults"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/errp"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/logging"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/socksproxy"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/test"
	"github.com/btcsuite/btcd/btcec/v2/ecdsa"
	"github.com/btcsuite/btcd/btcutil/hdkeychain"
	"github.com/btcsuite/btcd/btcutil/psbt"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/chaincfg/chainhash"
	"github.com/btcsuite/btcd/txscript"
	"github.com/btcsuite/btcd/wire"
	"github.com/stretchr/testify/require"
)

func boolPtr(value bool) *bool {
	return &value
}

type testVaultSigner struct {
	master   *hdkeychain.ExtendedKey
	keystore *keystoremock.KeystoreMock
}

func (signer *testVaultSigner) rootFingerprint() ([]byte, error) {
	keypath, err := signing.NewAbsoluteKeypath("m/84'")
	if err != nil {
		return nil, err
	}
	xprv, err := keypath.Derive(signer.master)
	if err != nil {
		return nil, err
	}
	rootFingerprint := make([]byte, 4)
	binary.BigEndian.PutUint32(rootFingerprint, xprv.ParentFingerprint())
	return rootFingerprint, nil
}

func (signer *testVaultSigner) name() (string, error) {
	rootFingerprint, err := signer.rootFingerprint()
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Test signer %x", rootFingerprint), nil
}

func (signer *testVaultSigner) extendedPublicKey(
	absoluteKeypath signing.AbsoluteKeypath,
) (*hdkeychain.ExtendedKey, error) {
	xprv, err := absoluteKeypath.Derive(signer.master)
	if err != nil {
		return nil, err
	}
	return xprv.Neuter()
}

func newSigningSessionTestKeystore(t *testing.T, label string) *testVaultSigner {
	t.Helper()

	seed := sha256.Sum256([]byte(label))
	master, err := hdkeychain.NewMaster(seed[:], &chaincfg.TestNet3Params)
	require.NoError(t, err)

	signer := &testVaultSigner{master: master}
	signer.keystore = &keystoremock.KeystoreMock{
		TypeFunc: func() keystorePkg.Type {
			return keystorePkg.TypeSoftware
		},
		NameFunc: signer.name,
		RootFingerprintFunc: func() ([]byte, error) {
			return signer.rootFingerprint()
		},
		SignTransactionFunc: func(proposedTransaction interface{}) error {
			btcProposedTx, ok := proposedTransaction.(*ProposedTransaction)
			if !ok {
				return errp.New("unexpected transaction type")
			}

			transaction := btcProposedTx.TXProposal.Psbt.UnsignedTx
			sigHashes := btcProposedTx.TXProposal.SigHashes()
			rootFingerprint, err := signer.rootFingerprint()
			if err != nil {
				return err
			}

			for index, txIn := range transaction.TxIn {
				spentOutput, ok := btcProposedTx.TXProposal.PreviousOutputs[txIn.PreviousOutPoint]
				if !ok {
					return errp.New("missing previous output")
				}
				address, err := btcProposedTx.GetKeystoreAddress(
					btcProposedTx.TXProposal.Coin.Code(),
					spentOutput.Address.PubkeyScriptHashHex(),
				)
				if err != nil {
					return err
				}
				if address == nil {
					return errp.New("missing keystore address")
				}

				var derivedKey addresses.DerivedKey
				found := false
				for _, candidate := range address.DerivedKeys {
					if bytes.Equal(candidate.RootFingerprint, rootFingerprint) {
						derivedKey = candidate
						found = true
						break
					}
				}
				if !found {
					return errp.New("connected keystore is not a participant of this vault")
				}

				xprv, err := derivedKey.AbsoluteKeypath.Derive(signer.master)
				if err != nil {
					return err
				}
				privateKey, err := xprv.ECPrivKey()
				if err != nil {
					return errp.WithStack(err)
				}

				_, subScript := address.ScriptForHashToSign()
				signatureHash, err := txscript.CalcWitnessSigHash(
					subScript,
					sigHashes,
					txscript.SigHashAll,
					transaction,
					index,
					spentOutput.TxOut.Value,
				)
				if err != nil {
					return errp.Wrap(err, "failed to calculate witness sighash")
				}

				partialSig := &psbt.PartialSig{
					PubKey:    privateKey.PubKey().SerializeCompressed(),
					Signature: append(ecdsa.Sign(privateKey, signatureHash).Serialize(), byte(txscript.SigHashAll)),
				}
				input := &btcProposedTx.TXProposal.Psbt.Inputs[index]
				alreadyPresent := false
				for _, existingSig := range input.PartialSigs {
					if bytes.Equal(existingSig.PubKey, partialSig.PubKey) {
						alreadyPresent = true
						break
					}
				}
				if !alreadyPresent {
					input.PartialSigs = append(input.PartialSigs, partialSig)
				}
			}
			return nil
		},
	}
	return signer
}

type signingSessionFixture struct {
	coin          *Coin
	blockchain    *blockchainMock.BlockchainMock
	accountConfig *config.Account
	dbFolder      string
	notesFolder   string
	signers       []*testVaultSigner
}

func newSigningSessionFixture(t *testing.T) *signingSessionFixture {
	t.Helper()

	dbFolder := test.TstTempDir("signing-sessions-db")
	notesFolder := test.TstTempDir("signing-sessions-notes")

	blockchainBackend := &blockchainMock.BlockchainMock{
		MockConnectionError: func() error { return nil },
		MockRegisterOnConnectionErrorChangedEvent: func(func(error)) {},
		MockScriptHashSubscribe:                    func(func() func(), blockchain.ScriptHashHex, func(string)) {},
	}
	coin := NewCoin(
		coinpkg.CodeTBTC,
		"Bitcoin Testnet",
		"TBTC",
		coinpkg.BtcUnitDefault,
		&chaincfg.TestNet3Params,
		dbFolder,
		nil,
		explorer,
		socksproxy.NewSocksProxy(false, ""),
	)
	coin.TstSetMakeBlockchain(func() blockchain.Interface { return blockchainBackend })

	signers := []*testVaultSigner{
		newSigningSessionTestKeystore(t, "session-signer-1"),
		newSigningSessionTestKeystore(t, "session-signer-2"),
		newSigningSessionTestKeystore(t, "session-signer-3"),
	}
	accountKeypath := vaults.BIP48AccountKeypath(coin.Code(), 0)
	participants := make([]signing.BitcoinPolicyParticipant, 0, len(signers))
	for _, signer := range signers {
		rootFingerprint, err := signer.rootFingerprint()
		require.NoError(t, err)
		xpub, err := signer.extendedPublicKey(accountKeypath)
		require.NoError(t, err)
		name, err := signer.name()
		require.NoError(t, err)
		participants = append(participants, signing.BitcoinPolicyParticipant{
			KeyInfo: signing.KeyInfo{
				RootFingerprint:   rootFingerprint,
				AbsoluteKeypath:   accountKeypath,
				ExtendedPublicKey: xpub,
			},
			Name: name,
		})
	}
	participants = vaults.CanonicalizeParticipants(participants)

	descriptorConfig, err := signing.NewBitcoinDescriptorConfiguration(vaults.AccountDescriptor(participants))
	require.NoError(t, err)

	accountConfig := &config.Account{
		Code:        "vault-signing-session-account",
		Name:        "Vault signing session account",
		CoinCode:    coinpkg.CodeTBTC,
		AccountType: config.AccountTypeVault,
		PolicyID: vaults.ComputePolicyID(
			coinpkg.CodeTBTC,
			vaults.PolicyTemplate2Of3,
			2,
			signing.ScriptTypeP2WSH,
			accountKeypath,
			participants,
		),
		Watch:                 boolPtr(true),
		SigningConfigurations: signing.Configurations{descriptorConfig},
	}

	return &signingSessionFixture{
		coin:          coin,
		blockchain:    blockchainBackend,
		accountConfig: accountConfig,
		dbFolder:      dbFolder,
		notesFolder:   notesFolder,
		signers:       signers,
	}
}

func (fixture *signingSessionFixture) newAccount(t *testing.T) (*Account, func(keystorePkg.Keystore)) {
	t.Helper()

	var currentKeystore keystorePkg.Keystore
	var account *Account

	account = NewAccount(
		&accounts.AccountConfig{
			Config:      fixture.accountConfig,
			DBFolder:    fixture.dbFolder,
			NotesFolder: fixture.notesFolder,
			ConnectKeystore: func() (keystorePkg.Keystore, error) {
				if currentKeystore == nil {
					return nil, errp.New("no keystore is currently connected")
				}
				return currentKeystore, nil
			},
			ConnectKeystoreByRootFingerprint: func(rootFingerprint []byte) (keystorePkg.Keystore, error) {
				for _, signer := range fixture.signers {
					candidateRootFingerprint, err := signer.rootFingerprint()
					require.NoError(t, err)
					if string(candidateRootFingerprint) == string(rootFingerprint) {
						return signer.keystore, nil
					}
				}
				return nil, errp.New("keystore not found")
			},
			CurrentKeystore: func() keystorePkg.Keystore {
				return currentKeystore
			},
			GetNotifier: func(signing.Configurations) accounts.Notifier {
				return nil
			},
			GetSaveFilename: func(string) string { return "" },
		},
		fixture.coin,
		nil,
		func(coinCode coinpkg.Code, scriptHashHex blockchain.ScriptHashHex) (*addresses.AccountAddress, error) {
			if coinCode != fixture.coin.Code() {
				return nil, nil
			}
			return account.GetAddress(scriptHashHex), nil
		},
		logging.Get().WithGroup("signing_sessions_test"),
		nil,
	)

	require.NoError(t, account.Initialize())
	for _, subaccount := range account.subaccounts {
		_, err := subaccount.receiveAddresses.EnsureAddresses()
		require.NoError(t, err)
		_, err = subaccount.changeAddresses.EnsureAddresses()
		require.NoError(t, err)
	}

	return account, func(keystore keystorePkg.Keystore) {
		currentKeystore = keystore
	}
}

func prepareSigningSessionProposal(t *testing.T, account *Account) *maketx.TxProposal {
	t.Helper()

	receiveAddresses, err := account.subaccounts[0].receiveAddresses.GetUnused()
	require.NoError(t, err)
	changeAddresses, err := account.subaccounts[0].changeAddresses.GetUnused()
	require.NoError(t, err)

	inputAddress := receiveAddresses[0]
	changeAddress := changeAddresses[0]
	previousOutputs := map[wire.OutPoint]maketx.UTXO{
		{
			Hash:  chainhash.HashH([]byte("vault-session-utxo")),
			Index: 0,
		}: {
			TxOut:   wire.NewTxOut(200_000, inputAddress.PubkeyScript()),
			Address: inputAddress,
		},
	}
	externalOutput := addressesTest.GetAddress(signing.ScriptTypeP2WPKH).PubkeyScript()
	txProposal, err := maketx.NewTx(
		account.coin,
		previousOutputs,
		maketx.NewOutputInfo(externalOutput),
		50_000,
		1_000,
		changeAddress,
		account.log,
	)
	require.NoError(t, err)

	unlock := account.activeTxProposalLock.Lock()
	account.activeTxProposal = txProposal
	unlock()

	return txProposal
}

func TestVaultSigningSessionPersistsAcrossRestartAndBroadcastLater(t *testing.T) {
	fixture := newSigningSessionFixture(t)
	broadcastAttempts := 0
	fixture.blockchain.MockTransactionBroadcast = func(*wire.MsgTx) error {
		broadcastAttempts++
		if broadcastAttempts == 1 {
			return errp.New("broadcast failed")
		}
		return nil
	}

	account, setCurrentKeystore := fixture.newAccount(t)
	prepareSigningSessionProposal(t, account)

	session, err := account.CreateSigningSession("vault-note")
	require.NoError(t, err)
	require.Equal(t, SigningSessionStateDraft, session.State)
	require.Empty(t, session.SignedBy)
	require.Len(t, session.MissingSigners, 3)
	require.Equal(t, 2, session.Threshold)

	setCurrentKeystore(fixture.signers[0].keystore)
	session, err = account.SignSigningSession(session.ID)
	require.NoError(t, err)
	require.Equal(t, SigningSessionStatePartiallySigned, session.State)
	require.Len(t, session.SignedBy, 1)
	require.Len(t, session.MissingSigners, 2)

	sessionID := session.ID
	account.Close()

	reopenedAccount, setCurrentKeystore := fixture.newAccount(t)
	defer reopenedAccount.Close()

	persistedSession, err := reopenedAccount.GetSigningSession(sessionID)
	require.NoError(t, err)
	require.NotNil(t, persistedSession)
	require.Equal(t, SigningSessionStatePartiallySigned, persistedSession.State)
	require.Len(t, persistedSession.SignedBy, 1)
	require.Len(t, persistedSession.MissingSigners, 2)

	setCurrentKeystore(fixture.signers[1].keystore)
	persistedSession, err = reopenedAccount.SignSigningSession(sessionID)
	require.NoError(t, err)
	require.Equal(t, SigningSessionStateReadyToBroadcast, persistedSession.State)
	require.Len(t, persistedSession.SignedBy, 2)
	require.Len(t, persistedSession.MissingSigners, 1)
	require.Equal(t, 1, broadcastAttempts)

	persistedSession, err = reopenedAccount.GetSigningSession(sessionID)
	require.NoError(t, err)
	require.NotNil(t, persistedSession)
	require.Equal(t, SigningSessionStateReadyToBroadcast, persistedSession.State)

	persistedSession, err = reopenedAccount.BroadcastSigningSession(sessionID)
	require.NoError(t, err)
	require.Equal(t, SigningSessionStateBroadcasted, persistedSession.State)
	require.NotEmpty(t, persistedSession.TxID)
	require.Equal(t, 2, broadcastAttempts)
	require.Equal(t, "vault-note", reopenedAccount.TxNote(persistedSession.TxID))

	sessions, err := reopenedAccount.ListSigningSessions()
	require.NoError(t, err)
	require.Len(t, sessions, 1)
	require.Equal(t, SigningSessionStateBroadcasted, sessions[0].State)

	setCurrentKeystore(fixture.signers[2].keystore)
	_, err = reopenedAccount.SignSigningSession(sessionID)
	require.ErrorContains(t, err, "can no longer be signed")
}
