// SPDX-License-Identifier: Apache-2.0

package backend

import (
	"bytes"
	"fmt"
	"time"

	accountsTypes "github.com/BitBoxSwiss/bitbox-wallet-app/backend/accounts/types"
	coinpkg "github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/coin"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/config"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/signing"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/vaults"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/errp"
)

func defaultVaultName(coin coinpkg.Coin, accountNumber uint16) string {
	if accountNumber > 0 {
		return fmt.Sprintf("%s Vault %d", coin.Name(), accountNumber+1)
	}
	return fmt.Sprintf("%s Vault", coin.Name())
}

func nextVaultAccountNumber(coinCode coinpkg.Code, accountsConfig *config.AccountsConfig) uint16 {
	var next uint16
	for _, account := range accountsConfig.Accounts {
		if account.CoinCode != coinCode || !account.IsVault() || len(account.SigningConfigurations) == 0 {
			continue
		}
		accountNumber, err := account.SigningConfigurations[0].AccountNumber()
		if err != nil {
			continue
		}
		if accountNumber >= next {
			next = accountNumber + 1
		}
	}
	return next
}

func vaultDescriptorConfigFromParticipants(
	coinCode coinpkg.Code,
	accountNumber uint16,
	participants []signing.BitcoinPolicyParticipant,
) (*signing.Configuration, error) {
	canonicalParticipants := vaults.CanonicalizeParticipants(participants)
	descriptor := vaults.AccountDescriptor(canonicalParticipants)
	config, err := signing.NewBitcoinDescriptorConfiguration(descriptor)
	if err != nil {
		return nil, err
	}
	if config.BitcoinDescriptor == nil {
		return nil, errp.New("vault descriptor configuration missing")
	}
	return config, nil
}

func (backend *Backend) persistVaultAccountConfig(
	coinCode coinpkg.Code,
	accountNumber uint16,
	name string,
	participants []signing.BitcoinPolicyParticipant,
	accountsConfig *config.AccountsConfig,
) (accountsTypes.Code, error) {
	accountCoin, err := backend.Coin(coinCode)
	if err != nil {
		return "", err
	}
	if name == "" {
		name = defaultVaultName(accountCoin, accountNumber)
	}
	canonicalParticipants := vaults.CanonicalizeParticipants(participants)
	accountKeypath := vaults.BIP48AccountKeypath(coinCode, accountNumber)
	policyID := vaults.ComputePolicyID(
		coinCode,
		vaults.PolicyTemplate2Of3,
		2,
		signing.ScriptTypeP2WSH,
		accountKeypath,
		canonicalParticipants,
	)
	descriptorConfig, err := vaultDescriptorConfigFromParticipants(coinCode, accountNumber, canonicalParticipants)
	if err != nil {
		return "", err
	}
	accountCode := vaultAccountCode(policyID, coinCode, accountNumber)
	if err := backend.persistAccount(config.Account{
		AccountType:           config.AccountTypeVault,
		PolicyID:              policyID,
		CoinCode:              coinCode,
		Name:                  name,
		Code:                  accountCode,
		Watch:                 boolPtr(true),
		SigningConfigurations: signing.Configurations{descriptorConfig},
	}, accountsConfig); err != nil {
		return "", err
	}

	for _, participant := range canonicalParticipants {
		ks := accountsConfig.GetOrAddKeystore(participant.KeyInfo.RootFingerprint)
		if participant.Name != "" {
			ks.Name = participant.Name
		}
	}
	return accountCode, nil
}

func boolPtr(value bool) *bool {
	return &value
}

func ensureVaultCoin(coinCode coinpkg.Code) error {
	switch coinCode {
	case coinpkg.CodeBTC, coinpkg.CodeTBTC, coinpkg.CodeRBTC:
		return nil
	default:
		return errp.New("vaults are only supported for btc, tbtc, and rbtc")
	}
}

// StartVaultSetup creates a persisted setup draft.
func (backend *Backend) StartVaultSetup(coinCode coinpkg.Code, name string) (*vaults.Draft, error) {
	if err := ensureVaultCoin(coinCode); err != nil {
		return nil, err
	}
	accountsConfig := backend.config.AccountsConfig()
	accountNumber := nextVaultAccountNumber(coinCode, &accountsConfig)
	return backend.vaultDraftStore.CreateDraft(coinCode, accountNumber, name)
}

// VaultSetupDrafts returns all visible setup drafts.
func (backend *Backend) VaultSetupDrafts() ([]*vaults.Draft, error) {
	return backend.vaultDraftStore.ListDrafts()
}

// VaultSetupDraft returns one setup draft.
func (backend *Backend) VaultSetupDraft(id string) (*vaults.Draft, error) {
	return backend.vaultDraftStore.GetDraft(id)
}

// EnrollVaultSigner enrolls all currently connected keystores into the given draft.
// Keystores that are already enrolled are silently skipped.
func (backend *Backend) EnrollVaultSigner(id string) (*vaults.Draft, error) {
	draft, err := backend.vaultDraftStore.GetDraft(id)
	if err != nil {
		return nil, err
	}
	coinInstance, err := backend.Coin(draft.Network)
	if err != nil {
		return nil, err
	}

	defer backend.accountsAndKeystoreLock.RLock()()
	if !backend.hasKeystores() {
		return nil, errp.New("no keystore connected")
	}

	enrolled := 0
	for _, ks := range backend.keystores {
		if !ks.SupportsAccount(coinInstance, signing.ScriptTypeP2WSH) {
			continue
		}
		rootFingerprint, err := ks.RootFingerprint()
		if err != nil {
			continue
		}
		// Skip if already enrolled.
		alreadyEnrolled := false
		for _, participant := range draft.Participants {
			if bytes.Equal(participant.KeyInfo.RootFingerprint, rootFingerprint) {
				alreadyEnrolled = true
				break
			}
		}
		if alreadyEnrolled {
			continue
		}
		xpub, err := ks.ExtendedPublicKey(coinInstance, draft.AccountKeypath)
		if err != nil {
			continue
		}
		name, err := ks.Name()
		if err != nil {
			continue
		}
		draft.Participants = append(draft.Participants, signing.BitcoinPolicyParticipant{
			KeyInfo: signing.KeyInfo{
				RootFingerprint:   rootFingerprint,
				AbsoluteKeypath:   draft.AccountKeypath,
				ExtendedPublicKey: xpub,
			},
			Name: name,
		})
		enrolled++
	}

	if enrolled == 0 {
		return nil, errp.New("no new signers to enroll")
	}

	if len(draft.Participants) >= 3 {
		draft.Participants = vaults.CanonicalizeParticipants(draft.Participants)
		draft.PolicyID = vaults.ComputePolicyID(
			draft.Network,
			vaults.PolicyTemplate2Of3,
			2,
			signing.ScriptTypeP2WSH,
			draft.AccountKeypath,
			draft.Participants,
		)
		if draft.Name == "" {
			coinInstance, _ := backend.Coin(draft.Network)
			draft.Name = defaultVaultName(coinInstance, draft.AccountNumber)
		}
		draft.State = vaults.DraftStateReadyForBackup
	}
	if err := backend.vaultDraftStore.SaveDraft(draft); err != nil {
		return nil, err
	}
	return draft, nil
}

// VaultSetupRecoveryFile returns the recovery export for a draft.
func (backend *Backend) VaultSetupRecoveryFile(id string) (*vaults.RecoveryFile, error) {
	draft, err := backend.vaultDraftStore.GetDraft(id)
	if err != nil {
		return nil, err
	}
	if len(draft.Participants) != 3 {
		return nil, errp.New("vault draft is not ready for backup")
	}
	return vaults.RecoveryFileFromDraft(draft), nil
}

// DiscardVaultSetup discards a persisted setup draft.
func (backend *Backend) DiscardVaultSetup(id string) error {
	return backend.vaultDraftStore.DeleteDraft(id)
}

// CompleteVaultSetup persists a completed vault account and removes the draft.
func (backend *Backend) CompleteVaultSetup(id string, name string, recoveryAcknowledged bool) (accountsTypes.Code, error) {
	draft, err := backend.vaultDraftStore.GetDraft(id)
	if err != nil {
		return "", err
	}
	if len(draft.Participants) != 3 {
		return "", errp.New("vault draft is incomplete")
	}
	if !recoveryAcknowledged {
		return "", errp.New("recovery backup must be acknowledged")
	}
	var accountCode accountsTypes.Code
	err = backend.config.ModifyAccountsConfig(func(accountsConfig *config.AccountsConfig) error {
		var err error
		accountCode, err = backend.persistVaultAccountConfig(
			draft.Network,
			draft.AccountNumber,
			name,
			draft.Participants,
			accountsConfig,
		)
		return err
	})
	if err != nil {
		return "", err
	}
	_ = backend.vaultDraftStore.DeleteDraft(id)
	backend.ReinitializeAccounts()
	return accountCode, nil
}

// ImportVaultRecovery imports a vault recovery file and creates a watch-only vault.
func (backend *Backend) ImportVaultRecovery(recovery *vaults.RecoveryFile, name string) (accountsTypes.Code, error) {
	if recovery.Format != vaults.RecoveryFormatV1 {
		return "", errp.New("unsupported recovery format")
	}
	if err := ensureVaultCoin(recovery.Network); err != nil {
		return "", err
	}
	if recovery.Threshold != 2 {
		return "", errp.New("unsupported threshold: only 2-of-3 is supported in v1")
	}
	if len(recovery.Participants) != 3 {
		return "", errp.New("expected exactly 3 participants for a 2-of-3 vault")
	}
	if recovery.ScriptType != signing.ScriptTypeP2WSH {
		return "", errp.New("unsupported script type: only P2WSH is supported in v1")
	}
	if recovery.Descriptor == "" {
		return "", errp.New("recovery file is missing descriptor")
	}
	for i, p := range recovery.Participants {
		if p.KeyInfo.ExtendedPublicKey == nil {
			return "", errp.Newf("participant %d has no extended public key", i)
		}
	}
	expectedDescriptor := vaults.AccountDescriptor(recovery.Participants)
	if recovery.Descriptor != expectedDescriptor {
		return "", errp.New("recovery descriptor does not match participant metadata")
	}
	var accountCode accountsTypes.Code
	err := backend.config.ModifyAccountsConfig(func(accountsConfig *config.AccountsConfig) error {
		var err error
		accountCode, err = backend.persistVaultAccountConfig(
			recovery.Network,
			recovery.AccountNumber,
			name,
			recovery.Participants,
			accountsConfig,
		)
		return err
	})
	if err != nil {
		return "", err
	}
	backend.ReinitializeAccounts()
	return accountCode, nil
}

// ExportVaultRecoveryFile exports the recovery file of an existing vault account.
func (backend *Backend) ExportVaultRecoveryFile(accountCode accountsTypes.Code) (*vaults.RecoveryFile, error) {
	account := backend.config.AccountsConfig().Lookup(accountCode)
	if account == nil || !account.IsVault() || len(account.SigningConfigurations) == 0 {
		return nil, errp.New("vault account not found")
	}
	cfg := account.SigningConfigurations[0]
	if cfg.BitcoinDescriptor == nil {
		return nil, errp.New("vault descriptor missing")
	}
	accountKeypath, err := cfg.BitcoinDescriptor.AccountKeypath()
	if err != nil {
		return nil, err
	}
	participants := make([]signing.BitcoinPolicyParticipant, 0, len(cfg.KeyInfos()))
	for _, keyInfo := range cfg.KeyInfos() {
		participant := signing.BitcoinPolicyParticipant{KeyInfo: keyInfo}
		if keystore, err := backend.config.AccountsConfig().LookupKeystore(keyInfo.RootFingerprint); err == nil {
			participant.Name = keystore.Name
		}
		participants = append(participants, participant)
	}
	draft := &vaults.Draft{
		ID:             string(accountCode),
		Network:        account.CoinCode,
		Name:           account.Name,
		AccountNumber:  mustAccountNumber(cfg),
		AccountKeypath: accountKeypath,
		Participants:   participants,
		CreatedAt:      timeNow(),
	}
	return vaults.RecoveryFileFromDraft(draft), nil
}

func mustAccountNumber(cfg *signing.Configuration) uint16 {
	accountNumber, err := cfg.AccountNumber()
	if err != nil {
		panic(err)
	}
	return accountNumber
}

var timeNow = func() time.Time {
	return time.Now()
}
