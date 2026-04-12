// SPDX-License-Identifier: Apache-2.0

package backend

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/accounts"
	accountsTypes "github.com/BitBoxSwiss/bitbox-wallet-app/backend/accounts/types"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc/blockchain"
	coinpkg "github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/coin"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/config"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/keystore"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/signing"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/vaults"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/vaults/backup"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/errp"
	"github.com/btcsuite/btcd/btcutil/hdkeychain"
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

func participantFingerprintHex(participant signing.BitcoinPolicyParticipant) string {
	return hex.EncodeToString(participant.KeyInfo.RootFingerprint)
}

func syncVaultDraftState(draft *vaults.Draft) {
	if draft.RegisteredSigners == nil {
		draft.RegisteredSigners = []string{}
	}
	if draft.State == vaults.DraftStateCompleted || draft.State == vaults.DraftStateDiscarded {
		return
	}
	participantFingerprints := make(map[string]struct{}, len(draft.Participants))
	for _, participant := range draft.Participants {
		participantFingerprints[participantFingerprintHex(participant)] = struct{}{}
	}
	filtered := make([]string, 0, len(draft.RegisteredSigners))
	for _, signer := range draft.RegisteredSigners {
		if _, ok := participantFingerprints[signer]; ok && !slices.Contains(filtered, signer) {
			filtered = append(filtered, signer)
		}
	}
	draft.RegisteredSigners = filtered

	switch {
	case len(draft.Participants) < 3:
		draft.State = vaults.DraftStateCollectingSigners
	case len(draft.RegisteredSigners) < 3:
		draft.State = vaults.DraftStateReadyForDeviceConfirmation
	default:
		draft.State = vaults.DraftStateReadyForBackup
	}
}

func vaultDraftParticipantByFingerprint(
	draft *vaults.Draft,
	rootFingerprint []byte,
) *signing.BitcoinPolicyParticipant {
	for _, participant := range draft.Participants {
		if bytes.Equal(participant.KeyInfo.RootFingerprint, rootFingerprint) {
			return &participant
		}
	}
	return nil
}

func vaultPolicyRegistrationName(draft *vaults.Draft) string {
	const maxNameLen = 30
	policySuffix := draft.PolicyID
	if len(policySuffix) > 4 {
		policySuffix = policySuffix[len(policySuffix)-4:]
	}
	suffix := ""
	if policySuffix != "" {
		suffix = fmt.Sprintf(" #%s", policySuffix)
	}
	name := strings.TrimSpace(draft.Name)
	if name == "" {
		name = "Vault"
	}
	maxBaseLen := maxNameLen - len(suffix)
	if maxBaseLen < 1 {
		return "Vault"
	}
	if len(name) > maxBaseLen {
		name = strings.TrimSpace(name[:maxBaseLen])
	}
	if name == "" {
		name = "Vault"
	}
	return name + suffix
}

func isDuplicateEntryError(err error) bool {
	return strings.Contains(strings.ToLower(err.Error()), "duplicate entry")
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
	drafts, err := backend.vaultDraftStore.ListDrafts()
	if err != nil {
		return nil, err
	}
	for _, draft := range drafts {
		syncVaultDraftState(draft)
	}
	return drafts, nil
}

// VaultSetupDraft returns one setup draft.
func (backend *Backend) VaultSetupDraft(id string) (*vaults.Draft, error) {
	draft, err := backend.vaultDraftStore.GetDraft(id)
	if err != nil {
		return nil, err
	}
	syncVaultDraftState(draft)
	return draft, nil
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
		if len(draft.Participants) >= 3 {
			break
		}
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
		syncVaultDraftState(draft)
	}
	if err := backend.vaultDraftStore.SaveDraft(draft); err != nil {
		return nil, err
	}
	return draft, nil
}

// ConfirmVaultSigner registers the final vault policy on one specific participant device.
func (backend *Backend) ConfirmVaultSigner(id string, rootFingerprint []byte) (*vaults.Draft, error) {
	draft, err := backend.vaultDraftStore.GetDraft(id)
	if err != nil {
		return nil, err
	}
	syncVaultDraftState(draft)
	if len(draft.Participants) != 3 {
		return nil, errp.New("vault draft is not ready for device confirmation")
	}
	if vaultDraftParticipantByFingerprint(draft, rootFingerprint) == nil {
		return nil, errp.New("signer is not part of this vault draft")
	}
	coinInstance, err := backend.Coin(draft.Network)
	if err != nil {
		return nil, err
	}
	descriptorConfig, err := vaultDescriptorConfigFromParticipants(
		draft.Network,
		draft.AccountNumber,
		draft.Participants,
	)
	if err != nil {
		return nil, err
	}
	ks, err := backend.ConnectKeystore(rootFingerprint)
	if err != nil {
		return nil, err
	}
	registered, err := ks.BTCIsScriptConfigRegistered(coinInstance, descriptorConfig)
	if err != nil {
		return nil, err
	}
	if !registered {
		name := vaultPolicyRegistrationName(draft)
		if err := ks.BTCRegisterScriptConfig(coinInstance, descriptorConfig, name); err != nil {
			if !isDuplicateEntryError(err) {
				return nil, err
			}
			registered, registeredErr := ks.BTCIsScriptConfigRegistered(coinInstance, descriptorConfig)
			if registeredErr != nil {
				return nil, registeredErr
			}
			if !registered {
				return nil, err
			}
		}
		registered, err = ks.BTCIsScriptConfigRegistered(coinInstance, descriptorConfig)
		if err != nil {
			return nil, err
		}
	}
	if !registered {
		return nil, errp.New("vault policy registration could not be verified")
	}
	signer := hex.EncodeToString(rootFingerprint)
	if !slices.Contains(draft.RegisteredSigners, signer) {
		draft.RegisteredSigners = append(draft.RegisteredSigners, signer)
		slices.Sort(draft.RegisteredSigners)
	}
	syncVaultDraftState(draft)
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
	syncVaultDraftState(draft)
	if draft.State != vaults.DraftStateReadyForBackup {
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
	syncVaultDraftState(draft)
	if len(draft.Participants) != 3 {
		return "", errp.New("vault draft is incomplete")
	}
	if len(draft.RegisteredSigners) != 3 {
		return "", errp.New("vault policy must be confirmed on all devices")
	}
	if !recoveryAcknowledged {
		return "", errp.New("recovery backup must be acknowledged")
	}
	var accountCode accountsTypes.Code
	err = backend.config.ModifyAccountsConfig(func(accountsConfig *config.AccountsConfig) error {
		// Remove any existing broken vault entry with the same code or policy ID so we can
		// re-create it cleanly. This handles the case where a previous setup attempt persisted
		// a vault with an empty/broken descriptor configuration.
		canonicalParticipants := vaults.CanonicalizeParticipants(draft.Participants)
		accountKeypath := vaults.BIP48AccountKeypath(draft.Network, draft.AccountNumber)
		expectedPolicyID := vaults.ComputePolicyID(
			draft.Network,
			vaults.PolicyTemplate2Of3,
			2,
			signing.ScriptTypeP2WSH,
			accountKeypath,
			canonicalParticipants,
		)
		expectedCode := vaultAccountCode(expectedPolicyID, draft.Network, draft.AccountNumber)
		cleaned := make([]*config.Account, 0, len(accountsConfig.Accounts))
		for _, acct := range accountsConfig.Accounts {
			if acct.Code == expectedCode || (acct.PolicyID == expectedPolicyID && acct.CoinCode == draft.Network) {
				backend.log.Infof("Removing stale vault account %s to re-create it", acct.Code)
				continue
			}
			cleaned = append(cleaned, acct)
		}
		accountsConfig.Accounts = cleaned

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

// VaultOnChainBackupPayload computes the encrypted backup payload for a vault draft.
// The payload is ready to be inscribed on-chain via a commit/reveal transaction pair.
func (backend *Backend) VaultOnChainBackupPayload(id string) ([]byte, error) {
	draft, err := backend.vaultDraftStore.GetDraft(id)
	if err != nil {
		return nil, err
	}
	if len(draft.Participants) != 3 {
		return nil, errp.New("vault draft is not ready for backup")
	}
	canonicalParticipants := vaults.CanonicalizeParticipants(draft.Participants)
	descriptor := vaults.AccountDescriptor(canonicalParticipants)

	var xpubs [3]*hdkeychain.ExtendedKey
	var rootFingerprints [3][]byte
	for i, p := range canonicalParticipants {
		xpubs[i] = p.KeyInfo.ExtendedPublicKey
		rootFingerprints[i] = p.KeyInfo.RootFingerprint
	}

	return backup.EncryptDescriptor(descriptor, draft.Network, draft.AccountNumber, xpubs, rootFingerprints)
}

// VaultOnChainBackupBeacons returns the 3 beacon addresses for a vault draft.
func (backend *Backend) VaultOnChainBackupBeacons(id string) ([3]*backup.BeaconResult, error) {
	draft, err := backend.vaultDraftStore.GetDraft(id)
	if err != nil {
		return [3]*backup.BeaconResult{}, err
	}
	if len(draft.Participants) != 3 {
		return [3]*backup.BeaconResult{}, errp.New("vault draft is not ready for backup")
	}
	canonicalParticipants := vaults.CanonicalizeParticipants(draft.Participants)
	var xpubs [3]*hdkeychain.ExtendedKey
	for i, p := range canonicalParticipants {
		xpubs[i] = p.KeyInfo.ExtendedPublicKey
	}
	return backup.AllBeaconAddresses(draft.Network, xpubs)
}

// VaultOnChainBackupPayloadFromAccount computes the encrypted backup payload for an existing vault account.
func (backend *Backend) VaultOnChainBackupPayloadFromAccount(accountCode accountsTypes.Code) ([]byte, error) {
	account := backend.config.AccountsConfig().Lookup(accountCode)
	if account == nil || !account.IsVault() || len(account.SigningConfigurations) == 0 {
		return nil, errp.New("vault account not found")
	}
	cfg := account.SigningConfigurations[0]
	if cfg.BitcoinDescriptor == nil {
		return nil, errp.New("vault descriptor missing")
	}
	accountNumber, err := cfg.AccountNumber()
	if err != nil {
		return nil, err
	}
	keyInfos := cfg.KeyInfos()
	if len(keyInfos) != 3 {
		return nil, errp.New("vault must have exactly 3 key infos")
	}
	var xpubs [3]*hdkeychain.ExtendedKey
	var rootFingerprints [3][]byte
	for i, ki := range keyInfos {
		xpubs[i] = ki.ExtendedPublicKey
		rootFingerprints[i] = ki.RootFingerprint
	}
	return backup.EncryptDescriptor(
		cfg.BitcoinDescriptor.Descriptor,
		account.CoinCode,
		accountNumber,
		xpubs,
		rootFingerprints,
	)
}

// VaultOnChainBackupBeaconsFromAccount returns the 3 beacon addresses for an existing vault account.
func (backend *Backend) VaultOnChainBackupBeaconsFromAccount(accountCode accountsTypes.Code) ([3]*backup.BeaconResult, error) {
	account := backend.config.AccountsConfig().Lookup(accountCode)
	if account == nil || !account.IsVault() || len(account.SigningConfigurations) == 0 {
		return [3]*backup.BeaconResult{}, errp.New("vault account not found")
	}
	keyInfos := account.SigningConfigurations[0].KeyInfos()
	if len(keyInfos) != 3 {
		return [3]*backup.BeaconResult{}, errp.New("vault must have exactly 3 key infos")
	}
	var xpubs [3]*hdkeychain.ExtendedKey
	for i, ki := range keyInfos {
		xpubs[i] = ki.ExtendedPublicKey
	}
	return backup.AllBeaconAddresses(account.CoinCode, xpubs)
}

// EligibleFundingAccount describes a standard account that can fund a vault.
type EligibleFundingAccount struct {
	Code    accountsTypes.Code `json:"code"`
	Name    string             `json:"name"`
	Balance string             `json:"balance"`
}

// GetEligibleFundingAccounts returns standard BTC accounts with balance that can fund the given vault.
func (backend *Backend) GetEligibleFundingAccounts(vaultAccountCode accountsTypes.Code) ([]EligibleFundingAccount, error) {
	vaultConfig := backend.config.AccountsConfig().Lookup(vaultAccountCode)
	if vaultConfig == nil || !vaultConfig.IsVault() {
		return nil, errp.New("vault account not found")
	}
	var result []EligibleFundingAccount
	for _, acct := range backend.Accounts() {
		acctConfig := acct.Config().Config
		if acctConfig.CoinCode != vaultConfig.CoinCode {
			continue
		}
		if acctConfig.IsVault() {
			continue
		}
		if !acct.Synced() {
			continue
		}
		balance, err := acct.Balance()
		if err != nil {
			continue
		}
		available := balance.Available()
		if available.BigInt().Sign() <= 0 {
			continue
		}
		result = append(result, EligibleFundingAccount{
			Code:    acctConfig.Code,
			Name:    acctConfig.Name,
			Balance: available.BigInt().String(),
		})
	}
	return result, nil
}

// FundVaultPropose creates a transaction proposal on the source account that sends to the vault
// receive address and includes OP_RETURN + beacon outputs for the descriptor backup.
func (backend *Backend) FundVaultPropose(
	sourceCode accountsTypes.Code,
	vaultCode accountsTypes.Code,
	args *accounts.TxProposalArgs,
) (coinpkg.Amount, coinpkg.Amount, coinpkg.Amount, error) {
	// Get vault backup payload.
	payload, err := backend.VaultOnChainBackupPayloadFromAccount(vaultCode)
	if err != nil {
		return coinpkg.Amount{}, coinpkg.Amount{}, coinpkg.Amount{}, errp.Wrap(err, "failed to get backup payload")
	}

	// Get vault beacon addresses.
	beacons, err := backend.VaultOnChainBackupBeaconsFromAccount(vaultCode)
	if err != nil {
		return coinpkg.Amount{}, coinpkg.Amount{}, coinpkg.Amount{}, errp.Wrap(err, "failed to get beacon addresses")
	}

	// Get the source account (must be a BTC account).
	sourceAccountIface, err := backend.GetAccountFromCode(sourceCode)
	if err != nil {
		return coinpkg.Amount{}, coinpkg.Amount{}, coinpkg.Amount{}, errp.Wrap(err, "source account not found")
	}
	sourceAccount, ok := sourceAccountIface.(*btc.Account)
	if !ok {
		return coinpkg.Amount{}, coinpkg.Amount{}, coinpkg.Amount{}, errp.New("source account is not a BTC account")
	}

	// Build OP_RETURN script with the encrypted payload.
	opReturnScript, err := backup.BuildOPReturnScript(payload)
	if err != nil {
		return coinpkg.Amount{}, coinpkg.Amount{}, coinpkg.Amount{}, errp.Wrap(err, "failed to build OP_RETURN script")
	}

	// Set the vault receive address as the recipient.
	vaultAccountIface, err := backend.GetAccountFromCode(vaultCode)
	if err != nil {
		return coinpkg.Amount{}, coinpkg.Amount{}, coinpkg.Amount{}, errp.Wrap(err, "vault account not found")
	}
	receiveAddresses, err := vaultAccountIface.GetUnusedReceiveAddresses()
	if err != nil || len(receiveAddresses) == 0 || len(receiveAddresses[0].Addresses) == 0 {
		return coinpkg.Amount{}, coinpkg.Amount{}, coinpkg.Amount{}, errp.New("could not get vault receive address")
	}
	args.RecipientAddress = receiveAddresses[0].Addresses[0].EncodeForHumans()

	// Additional outputs: OP_RETURN (value=0) + 3 beacon dust outputs.
	args.AdditionalOutputs = []accounts.AdditionalOutput{
		{PkScript: opReturnScript, Value: 0},
		{PkScript: beacons[0].PkScript, Value: backup.BeaconDust},
		{PkScript: beacons[1].PkScript, Value: backup.BeaconDust},
		{PkScript: beacons[2].PkScript, Value: backup.BeaconDust},
	}

	// Propose the transaction on the source account.
	return sourceAccount.TxProposal(args)
}

// FundVaultSend signs and broadcasts the funding transaction which includes the OP_RETURN
// descriptor backup and beacon outputs in a single transaction.
func (backend *Backend) FundVaultSend(
	sourceCode accountsTypes.Code,
	note string,
) (string, error) {
	sourceAccountIface, err := backend.GetAccountFromCode(sourceCode)
	if err != nil {
		return "", errp.Wrap(err, "source account not found")
	}
	sourceAccount, ok := sourceAccountIface.(*btc.Account)
	if !ok {
		return "", errp.New("source account is not a BTC account")
	}

	txID, err := sourceAccount.SendTx(note)
	if err != nil {
		return "", errp.Wrap(err, "failed to send funding transaction")
	}

	backend.log.Infof("Fund vault: tx %s", txID)
	return txID, nil
}

// RecoverVaultFromChain attempts to recover a vault from on-chain backup using a single xpub.
// The xpub should be from any one of the vault participants.
func (backend *Backend) RecoverVaultFromChain(
	bc blockchain.Interface,
	network coinpkg.Code,
	xpub *hdkeychain.ExtendedKey,
	name string,
) (accountsTypes.Code, error) {
	result, err := backup.ScanForBackup(bc, network, xpub)
	if err != nil {
		return "", errp.Wrap(err, "on-chain backup scan failed")
	}

	recovery, err := vaults.RecoveryFileFromDescriptor(result.Descriptor, network, result.AccountNumber)
	if err != nil {
		return "", errp.Wrap(err, "failed to reconstruct recovery file from descriptor")
	}

	return backend.ImportVaultRecovery(recovery, name)
}

// maybeDiscoverVaults scans the blockchain for on-chain vault backups that include the
// connected keystore as a participant. It derives beacon addresses for each account number
// and queries Electrum for transactions. If a valid backup is found, the vault is imported.
// This mirrors maybeAddHiddenUnusedAccounts for standard account discovery.
func (backend *Backend) maybeDiscoverVaults(ks keystore.Keystore) {
	backend.log.Info("vault discovery: starting scan")
	// Vault discovery only applies to BTC-family coins.
	var coinCodes []coinpkg.Code
	switch {
	case backend.arguments.Regtest():
		coinCodes = []coinpkg.Code{coinpkg.CodeRBTC}
	case backend.Testing():
		coinCodes = []coinpkg.Code{coinpkg.CodeTBTC}
	default:
		coinCodes = []coinpkg.Code{coinpkg.CodeBTC}
	}

	for _, coinCode := range coinCodes {
		coinInstance, err := backend.Coin(coinCode)
		if err != nil {
			backend.log.WithError(err).Errorf("vault discovery: could not get coin %s", coinCode)
			continue
		}
		if !ks.SupportsCoin(coinInstance) {
			continue
		}
		btcCoin, ok := coinInstance.(*btc.Coin)
		if !ok {
			continue
		}
		// Ensure the coin's Electrum connection is initialized.
		btcCoin.Initialize()
		bc := btcCoin.Blockchain()

		for accountNumber := uint16(0); accountNumber < backup.MaxAccountScan; accountNumber++ {
			accountKeypath := vaults.BIP48AccountKeypath(coinCode, accountNumber)
			xpub, err := ks.ExtendedPublicKey(coinInstance, accountKeypath)
			if err != nil {
				backend.log.WithError(err).Errorf(
					"vault discovery: could not get xpub for %s account %d", coinCode, accountNumber)
				break
			}

			backend.log.Infof("vault discovery: scanning %s account %d", coinCode, accountNumber)
			scanResult, err := backend.scanBeaconForVaults(bc, coinCode, xpub)
			if err != nil {
				backend.log.WithError(err).Warnf(
					"vault discovery: transient scan failure for %s account %d", coinCode, accountNumber)
				continue
			}
			if scanResult.NoHistory {
				backend.log.Infof("vault discovery: no beacon history for %s account %d, stopping", coinCode, accountNumber)
				break
			}
			if len(scanResult.Recoveries) == 0 {
				// Beacon had history but no valid backup — continue to next account number.
				continue
			}

			for _, recovery := range scanResult.Recoveries {
				_, importErr := backend.ImportVaultRecovery(recovery, "")
				if importErr != nil {
					// errAccountAlreadyExists is expected for vaults we already know about.
					backend.log.WithError(importErr).Debug("vault discovery: import skipped or failed")
					continue
				}
				backend.log.Infof("vault discovery: auto-discovered vault for %s account %d",
					coinCode, recovery.AccountNumber)
			}
		}
	}
}

type vaultBeaconScanResult struct {
	Recoveries []*vaults.RecoveryFile
	NoHistory  bool
}

// scanBeaconForVaults checks a single beacon address for one or more valid on-chain vault backups.
func (backend *Backend) scanBeaconForVaults(
	bc blockchain.Interface,
	coinCode coinpkg.Code,
	xpub *hdkeychain.ExtendedKey,
) (*vaultBeaconScanResult, error) {
	beacon, err := backup.ComputeBeaconAddress(coinCode, xpub)
	if err != nil {
		return nil, errp.Wrap(err, "failed to compute beacon")
	}

	// Some Electrum server implementations (e.g. electrs) require subscribing to a scripthash
	// before its history can be queried. Subscribe first and wait for the initial status response.
	subscribed := make(chan struct{}, 1)
	bc.ScriptHashSubscribe(
		func() func() { return func() {} },
		beacon.ScriptHashHex,
		func(string) {
			select {
			case subscribed <- struct{}{}:
			default:
			}
		},
	)
	select {
	case <-subscribed:
		backend.log.Debug("vault discovery: beacon subscribed successfully")
	case <-time.After(30 * time.Second):
		return nil, errp.New("timeout waiting for beacon subscribe")
	}

	history, err := bc.ScriptHashGetHistory(beacon.ScriptHashHex)
	if err != nil {
		return nil, errp.Wrap(err, "failed to query beacon history")
	}

	if len(history) == 0 {
		return &vaultBeaconScanResult{NoHistory: true}, nil
	}

	recoveryByPolicyID := map[string]*vaults.RecoveryFile{}
	for _, txInfo := range history {
		txHash := txInfo.TXHash.Hash()
		tx, err := bc.TransactionGet(txHash)
		if err != nil {
			continue
		}
		payload := backup.ParseOPReturnPayload(tx)
		if payload == nil {
			continue
		}
		descriptor, acctNum, _, err := backup.TryDecryptDescriptor(payload, coinCode, xpub)
		if err != nil {
			continue
		}
		rec, err := vaults.RecoveryFileFromDescriptor(descriptor, coinCode, acctNum)
		if err != nil {
			backend.log.WithError(err).Error("vault discovery: failed to reconstruct recovery file")
			continue
		}
		recoveryByPolicyID[rec.PolicyID] = rec
	}
	result := &vaultBeaconScanResult{
		Recoveries: make([]*vaults.RecoveryFile, 0, len(recoveryByPolicyID)),
	}
	for _, recovery := range recoveryByPolicyID {
		result.Recoveries = append(result.Recoveries, recovery)
	}
	slices.SortFunc(result.Recoveries, func(a, b *vaults.RecoveryFile) int {
		if a.AccountNumber != b.AccountNumber {
			if a.AccountNumber < b.AccountNumber {
				return -1
			}
			return 1
		}
		switch {
		case a.PolicyID < b.PolicyID:
			return -1
		case a.PolicyID > b.PolicyID:
			return 1
		default:
			return 0
		}
	})
	return result, nil
}
