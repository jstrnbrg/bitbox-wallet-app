// SPDX-License-Identifier: Apache-2.0

package backend

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"testing"
	"time"

	coinpkg "github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/coin"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/keystore/software"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/signing"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/vaults"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/errp"
	"github.com/btcsuite/btcd/btcutil/hdkeychain"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/stretchr/testify/require"
)

func newVaultTestKeystore(t *testing.T, label string) *software.Keystore {
	t.Helper()

	seed := sha256.Sum256([]byte(label))
	master, err := hdkeychain.NewMaster(seed[:], &chaincfg.TestNet3Params)
	require.NoError(t, err)
	return software.NewKeystore(master)
}

func vaultTestParticipants(
	t *testing.T,
	coin coinpkg.Coin,
	accountNumber uint16,
	keystores ...*software.Keystore,
) []signing.BitcoinPolicyParticipant {
	t.Helper()

	accountKeypath := vaults.BIP48AccountKeypath(coin.Code(), accountNumber)
	participants := make([]signing.BitcoinPolicyParticipant, 0, len(keystores))
	for _, ks := range keystores {
		rootFingerprint, err := ks.RootFingerprint()
		require.NoError(t, err)
		xpub, err := ks.ExtendedPublicKey(coin, accountKeypath)
		require.NoError(t, err)
		name, err := ks.Name()
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
	return participants
}

func descriptorForChain(
	chainIndex uint32,
	participants []signing.BitcoinPolicyParticipant,
) string {
	keys := make([]string, len(participants))
	for i, participant := range vaults.CanonicalizeParticipants(participants) {
		keys[i] = fmt.Sprintf(
			"[%x/%s]%s/%d/*",
			participant.KeyInfo.RootFingerprint,
			strings.TrimPrefix(participant.KeyInfo.AbsoluteKeypath.Encode(), "m/"),
			participant.KeyInfo.ExtendedPublicKey.String(),
			chainIndex,
		)
	}
	return fmt.Sprintf("wsh(sortedmulti(2,%s))", strings.Join(keys, ","))
}

func TestVaultSetupLifecycle(t *testing.T) {
	backend := newBackend(t, testnetEnabled, regtestDisabled)
	defer backend.Close()

	_, err := backend.StartVaultSetup(coinpkg.CodeLTC, "")
	require.ErrorContains(t, err, "vaults are only supported")

	coin, err := backend.Coin(coinpkg.CodeTBTC)
	require.NoError(t, err)
	signers := []*software.Keystore{
		newVaultTestKeystore(t, "vault-signer-1"),
		newVaultTestKeystore(t, "vault-signer-2"),
		newVaultTestKeystore(t, "vault-signer-3"),
	}

	draft, err := backend.StartVaultSetup(coinpkg.CodeTBTC, "")
	require.NoError(t, err)
	require.Equal(t, coinpkg.CodeTBTC, draft.Network)
	require.Equal(t, uint16(0), draft.AccountNumber)
	require.Equal(t, vaults.DraftStateCollectingSigners, draft.State)
	require.Equal(t, vaults.BIP48AccountKeypath(coinpkg.CodeTBTC, 0), draft.AccountKeypath)
	require.Empty(t, draft.Participants)

	setTestKeystore := func(ks *software.Keystore) {
		fp, err := ks.RootFingerprint()
		require.NoError(t, err)
		// Clear previous keystores and set the new one.
		for k := range backend.keystores {
			delete(backend.keystores, k)
		}
		backend.keystores[hex.EncodeToString(fp)] = ks
	}

	setTestKeystore(signers[0])
	draft, err = backend.EnrollVaultSigner(draft.ID)
	require.NoError(t, err)
	require.Len(t, draft.Participants, 1)
	require.Equal(t, vaults.DraftStateCollectingSigners, draft.State)

	_, err = backend.EnrollVaultSigner(draft.ID)
	require.ErrorContains(t, err, "signer already enrolled")

	setTestKeystore(signers[1])
	draft, err = backend.EnrollVaultSigner(draft.ID)
	require.NoError(t, err)
	require.Len(t, draft.Participants, 2)
	require.Equal(t, vaults.DraftStateCollectingSigners, draft.State)

	_, err = backend.VaultSetupRecoveryFile(draft.ID)
	require.ErrorContains(t, err, "not ready for backup")

	setTestKeystore(signers[2])
	draft, err = backend.EnrollVaultSigner(draft.ID)
	require.NoError(t, err)
	require.Len(t, draft.Participants, 3)
	require.Equal(t, vaults.DraftStateReadyForBackup, draft.State)
	require.Equal(t, defaultVaultName(coin, 0), draft.Name)
	require.Equal(t, vaults.CanonicalizeParticipants(draft.Participants), draft.Participants)

	expectedPolicyID := vaults.ComputePolicyID(
		coinpkg.CodeTBTC,
		vaults.PolicyTemplate2Of3,
		2,
		signing.ScriptTypeP2WSH,
		draft.AccountKeypath,
		draft.Participants,
	)
	require.Equal(t, expectedPolicyID, draft.PolicyID)

	recovery, err := backend.VaultSetupRecoveryFile(draft.ID)
	require.NoError(t, err)
	require.Equal(t, vaults.RecoveryFormatV1, recovery.Format)
	require.Equal(t, vaults.PolicyTemplate2Of3, recovery.Policy)
	require.Equal(t, signing.ScriptTypeP2WSH, recovery.ScriptType)
	require.Equal(t, 2, recovery.Threshold)
	require.Equal(t, draft.PolicyID, recovery.PolicyID)
	require.Equal(t, draft.AccountNumber, recovery.AccountNumber)
	require.Equal(t, draft.AccountKeypath, recovery.AccountKeypath)
	require.Equal(t, vaults.AccountDescriptor(draft.Participants), recovery.Descriptor)
	require.Equal(t, descriptorForChain(0, draft.Participants), recovery.Descriptors.Receive)
	require.Equal(t, descriptorForChain(1, draft.Participants), recovery.Descriptors.Change)

	_, err = backend.CompleteVaultSetup(draft.ID, "", false)
	require.ErrorContains(t, err, "recovery backup must be acknowledged")

	accountCode, err := backend.CompleteVaultSetup(draft.ID, "", true)
	require.NoError(t, err)
	require.Equal(t, vaultAccountCode(draft.PolicyID, coinpkg.CodeTBTC, 0), accountCode)

	persisted := backend.Config().AccountsConfig().Lookup(accountCode)
	require.NotNil(t, persisted)
	require.True(t, persisted.IsVault())
	require.NotNil(t, persisted.Watch)
	require.True(t, *persisted.Watch)
	require.Equal(t, draft.PolicyID, persisted.PolicyID)
	require.Equal(t, defaultVaultName(coin, 0), persisted.Name)
	require.Len(t, persisted.SigningConfigurations, 1)
	require.NotNil(t, persisted.SigningConfigurations[0].BitcoinDescriptor)
	require.Equal(t, recovery.Descriptor, persisted.SigningConfigurations[0].BitcoinDescriptor.Descriptor)

	for _, signer := range signers {
		rootFingerprint, err := signer.RootFingerprint()
		require.NoError(t, err)
		name, err := signer.Name()
		require.NoError(t, err)
		keystore, err := backend.Config().AccountsConfig().LookupKeystore(rootFingerprint)
		require.NoError(t, err)
		require.Equal(t, name, keystore.Name)
	}

	_, err = backend.VaultSetupDraft(draft.ID)
	require.ErrorContains(t, err, "vault draft not found")

	exported, err := backend.ExportVaultRecoveryFile(accountCode)
	require.NoError(t, err)
	require.Equal(t, recovery.Format, exported.Format)
	require.Equal(t, recovery.Policy, exported.Policy)
	require.Equal(t, recovery.Descriptor, exported.Descriptor)
	require.Equal(t, recovery.PolicyID, exported.PolicyID)
	require.Equal(t, recovery.AccountNumber, exported.AccountNumber)
	require.Equal(t, recovery.AccountKeypath, exported.AccountKeypath)
	require.Equal(t, recovery.Descriptors.Receive, exported.Descriptors.Receive)
	require.Equal(t, recovery.Descriptors.Change, exported.Descriptors.Change)
	require.Len(t, exported.Participants, 3)
	for _, participant := range exported.Participants {
		keystore, err := backend.Config().AccountsConfig().LookupKeystore(participant.KeyInfo.RootFingerprint)
		require.NoError(t, err)
		require.Equal(t, keystore.Name, participant.Name)
	}

	nextDraft, err := backend.StartVaultSetup(coinpkg.CodeTBTC, "")
	require.NoError(t, err)
	require.Equal(t, uint16(1), nextDraft.AccountNumber)
	require.NoError(t, backend.DiscardVaultSetup(nextDraft.ID))
}

func TestImportVaultRecoveryValidationAndDuplicateProtection(t *testing.T) {
	backend := newBackend(t, testnetEnabled, regtestDisabled)
	defer backend.Close()

	coin, err := backend.Coin(coinpkg.CodeTBTC)
	require.NoError(t, err)
	signers := []*software.Keystore{
		newVaultTestKeystore(t, "import-signer-1"),
		newVaultTestKeystore(t, "import-signer-2"),
		newVaultTestKeystore(t, "import-signer-3"),
	}
	participants := vaultTestParticipants(t, coin, 0, signers...)
	recovery := vaults.RecoveryFileFromDraft(&vaults.Draft{
		ID:             "draft",
		Network:        coinpkg.CodeTBTC,
		Name:           "Imported",
		AccountNumber:  0,
		AccountKeypath: vaults.BIP48AccountKeypath(coinpkg.CodeTBTC, 0),
		Participants:   participants,
		CreatedAt:      time.Unix(1, 0),
	})

	tampered := *recovery
	tampered.Descriptor = tampered.Descriptor + "-tampered"

	_, err = backend.ImportVaultRecovery(&tampered, "Imported")
	require.ErrorContains(t, err, "recovery descriptor does not match participant metadata")

	accountCode, err := backend.ImportVaultRecovery(recovery, "")
	require.NoError(t, err)
	require.Equal(t, vaultAccountCode(recovery.PolicyID, coinpkg.CodeTBTC, 0), accountCode)

	persisted := backend.Config().AccountsConfig().Lookup(accountCode)
	require.NotNil(t, persisted)
	require.True(t, persisted.IsVault())
	require.Equal(t, defaultVaultName(coin, 0), persisted.Name)

	exported, err := backend.ExportVaultRecoveryFile(accountCode)
	require.NoError(t, err)
	require.Equal(t, recovery.Descriptor, exported.Descriptor)
	require.Equal(t, recovery.PolicyID, exported.PolicyID)

	_, err = backend.ImportVaultRecovery(recovery, "Duplicate")
	require.Error(t, err)
	require.Equal(t, errAccountAlreadyExists, errp.Cause(err))
}
