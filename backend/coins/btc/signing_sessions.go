// SPDX-License-Identifier: Apache-2.0

package btc

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"sort"
	"time"

	backendAccounts "github.com/BitBoxSwiss/bitbox-wallet-app/backend/accounts"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc/blockchain"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc/maketx"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc/transactions"
	btcutilpkg "github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc/util"
	backendKeystore "github.com/BitBoxSwiss/bitbox-wallet-app/backend/keystore"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/signing"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/errp"
	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/btcutil/psbt"
	"github.com/btcsuite/btcd/wire"
)

type SigningSessionState string

const (
	SigningSessionStateDraft            SigningSessionState = "draft"
	SigningSessionStatePartiallySigned  SigningSessionState = "partiallySigned"
	SigningSessionStateReadyToBroadcast SigningSessionState = "readyToBroadcast"
	SigningSessionStateBroadcasted      SigningSessionState = "broadcasted"
	SigningSessionStateAbandoned        SigningSessionState = "abandoned"
)

type SigningSession struct {
	ID                   string                          `json:"id"`
	State                SigningSessionState             `json:"state"`
	CreatedAt            time.Time                       `json:"createdAt"`
	UpdatedAt            time.Time                       `json:"updatedAt"`
	PSBT                 []byte                          `json:"psbt"`
	RecipientAddress     string                          `json:"recipientAddress"`
	Amount               int64                           `json:"amount"`
	Fee                  int64                           `json:"fee"`
	Total                int64                           `json:"total"`
	Note                 string                          `json:"note"`
	SignedBy             []string                        `json:"signedBy"`
	MissingSigners       []string                        `json:"missingSigners"`
	Threshold            int                             `json:"threshold"`
	TxID                 string                          `json:"txId,omitempty"`
	OutIndex             int                             `json:"outIndex"`
	SilentPaymentAddress string                          `json:"silentPaymentAddress,omitempty"`
	PaymentRequest       *backendAccounts.PaymentRequest `json:"paymentRequest,omitempty"`
}

func newSigningSessionID() (string, error) {
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", errp.WithStack(err)
	}
	return hex.EncodeToString(random[:]), nil
}

func serializePSBT(packet *psbt.Packet) ([]byte, error) {
	var buffer bytes.Buffer
	if err := packet.Serialize(&buffer); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func parsePSBT(data []byte) (*psbt.Packet, error) {
	return psbt.NewFromRawBytes(bytes.NewReader(data), false)
}

func containsSigner(signers []string, signer string) bool {
	for _, candidate := range signers {
		if candidate == signer {
			return true
		}
	}
	return false
}

func removeSigner(signers []string, signer string) []string {
	result := make([]string, 0, len(signers))
	for _, candidate := range signers {
		if candidate != signer {
			result = append(result, candidate)
		}
	}
	return result
}

func signingSessionParticipants(configuration *signing.Configuration) []string {
	rootFingerprints, err := configuration.RootFingerprints()
	if err != nil {
		return nil
	}
	result := make([]string, 0, len(rootFingerprints))
	for _, rootFingerprint := range rootFingerprints {
		result = append(result, hex.EncodeToString(rootFingerprint))
	}
	return result
}

func (account *Account) vaultConfiguration() (*signing.Configuration, error) {
	if !account.Config().Config.IsVault() {
		return nil, errp.New("vault signing sessions are only available for vault accounts")
	}
	if len(account.subaccounts) != 1 {
		return nil, errp.New("vault account must have exactly one signing configuration")
	}
	return account.subaccounts[0].signingConfiguration, nil
}

func (account *Account) saveSigningSession(session *SigningSession) error {
	data, err := json.Marshal(session)
	if err != nil {
		return errp.WithStack(err)
	}
	return transactions.DBUpdate(account.db, func(dbTx transactions.DBTxInterface) error {
		return dbTx.PutSigningSession(session.ID, data)
	})
}

func (account *Account) loadSigningSession(id string) (*SigningSession, error) {
	data, err := transactions.DBView(account.db, func(dbTx transactions.DBTxInterface) ([]byte, error) {
		return dbTx.SigningSession(id)
	})
	if err != nil {
		return nil, err
	}
	if data == nil {
		return nil, nil
	}
	session := &SigningSession{}
	if err := json.Unmarshal(data, session); err != nil {
		return nil, errp.WithStack(err)
	}
	if session.SignedBy == nil {
		session.SignedBy = []string{}
	}
	if session.MissingSigners == nil {
		session.MissingSigners = []string{}
	}
	return session, nil
}

func (account *Account) ListSigningSessions() ([]*SigningSession, error) {
	sessionsMap, err := transactions.DBView(account.db, func(dbTx transactions.DBTxInterface) (map[string][]byte, error) {
		return dbTx.SigningSessions()
	})
	if err != nil {
		return nil, err
	}
	result := make([]*SigningSession, 0, len(sessionsMap))
	for _, data := range sessionsMap {
		session := &SigningSession{}
		if err := json.Unmarshal(data, session); err != nil {
			return nil, errp.WithStack(err)
		}
		result = append(result, session)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].UpdatedAt.After(result[j].UpdatedAt)
	})
	return result, nil
}

func (account *Account) GetSigningSession(id string) (*SigningSession, error) {
	return account.loadSigningSession(id)
}

func (account *Account) proposedTransactionForSigning(txProposal *maketx.TxProposal) *ProposedTransaction {
	return &ProposedTransaction{
		TXProposal:                   txProposal,
		AccountName:                  account.Config().Config.Name,
		AccountSigningConfigurations: account.subaccounts.signingConfigurations(),
		GetPrevTx:                    account.coin.Blockchain().TransactionGet,
		FormatUnit:                   account.coin.formatUnit,
		GetKeystoreAddress:           account.getAddressFromSameKeystore,
	}
}

func (account *Account) proposedTransactionFromSession(session *SigningSession) (*ProposedTransaction, error) {
	packet, err := parsePSBT(session.PSBT)
	if err != nil {
		return nil, err
	}
	previousOutputs := make(maketx.PreviousOutputs, len(packet.UnsignedTx.TxIn))
	for index, txIn := range packet.UnsignedTx.TxIn {
		input := packet.Inputs[index]
		var txOut *wire.TxOut
		switch {
		case input.WitnessUtxo != nil:
			txOut = input.WitnessUtxo
		case input.NonWitnessUtxo != nil:
			prevIndex := txIn.PreviousOutPoint.Index
			if int(prevIndex) >= len(input.NonWitnessUtxo.TxOut) {
				return nil, errp.New("PSBT input is missing the referenced non-witness output")
			}
			txOut = input.NonWitnessUtxo.TxOut[prevIndex]
		default:
			return nil, errp.New("PSBT input is missing its previous output")
		}
		address := account.GetAddress(blockchain.NewScriptHashHex(txOut.PkScript))
		if address == nil {
			return nil, errp.New("could not reconstruct signing session input address")
		}
		previousOutputs[txIn.PreviousOutPoint] = maketx.UTXO{
			TxOut:   txOut,
			Address: address,
		}
	}

	return account.proposedTransactionForSigning(&maketx.TxProposal{
		Coin:                 account.coin,
		Amount:               btcutil.Amount(session.Amount),
		Fee:                  btcutil.Amount(session.Fee),
		PreviousOutputs:      previousOutputs,
		PaymentRequest:       session.PaymentRequest,
		SilentPaymentAddress: session.SilentPaymentAddress,
		OutIndex:             session.OutIndex,
		Psbt:                 packet,
	}), nil
}

func (account *Account) connectVaultSigner(missingSigners []string) (backendKeystore.Keystore, string, error) {
	currentKeystore := account.Config().CurrentKeystore()
	if currentKeystore != nil {
		rootFingerprint, err := currentKeystore.RootFingerprint()
		if err == nil {
			signer := hex.EncodeToString(rootFingerprint)
			if containsSigner(missingSigners, signer) {
				return currentKeystore, signer, nil
			}
		}
	}
	if len(missingSigners) == 0 {
		return nil, "", errp.New("there are no missing signers for this vault session")
	}
	rootFingerprint, err := hex.DecodeString(missingSigners[0])
	if err != nil {
		return nil, "", errp.WithStack(err)
	}
	keystore, err := account.Config().ConnectKeystoreByRootFingerprint(rootFingerprint)
	if err != nil {
		return nil, "", err
	}
	return keystore, missingSigners[0], nil
}

func (account *Account) CreateSigningSession(note string) (*SigningSession, error) {
	configuration, err := account.vaultConfiguration()
	if err != nil {
		return nil, err
	}

	unlock := account.activeTxProposalLock.RLock()
	txProposal := account.activeTxProposal
	unlock()
	if txProposal == nil {
		return nil, errp.New("No active tx proposal")
	}

	proposedTransaction := account.proposedTransactionForSigning(txProposal)
	if err := proposedTransaction.Update(); err != nil {
		return nil, err
	}
	psbtBytes, err := serializePSBT(txProposal.Psbt)
	if err != nil {
		return nil, err
	}

	sessionID, err := newSigningSessionID()
	if err != nil {
		return nil, err
	}

	recipientAddress := txProposal.SilentPaymentAddress
	if recipientAddress == "" {
		if txProposal.OutIndex < 0 || txProposal.OutIndex >= len(txProposal.Psbt.UnsignedTx.TxOut) {
			return nil, errp.New("transaction proposal output index is invalid")
		}
		address, err := btcutilpkg.AddressFromPkScript(
			txProposal.Psbt.UnsignedTx.TxOut[txProposal.OutIndex].PkScript,
			account.coin.Net(),
		)
		if err != nil {
			return nil, err
		}
		recipientAddress = address.EncodeAddress()
	}

	now := time.Now()
	session := &SigningSession{
		ID:                   sessionID,
		State:                SigningSessionStateDraft,
		CreatedAt:            now,
		UpdatedAt:            now,
		PSBT:                 psbtBytes,
		RecipientAddress:     recipientAddress,
		Amount:               int64(txProposal.Amount),
		Fee:                  int64(txProposal.Fee),
		Total:                int64(txProposal.Total()),
		Note:                 note,
		SignedBy:             []string{},
		MissingSigners:       signingSessionParticipants(configuration),
		Threshold:            configuration.Threshold(),
		OutIndex:             txProposal.OutIndex,
		SilentPaymentAddress: txProposal.SilentPaymentAddress,
		PaymentRequest:       txProposal.PaymentRequest,
	}

	if err := account.saveSigningSession(session); err != nil {
		return nil, err
	}
	return session, nil
}

func (account *Account) signAndMaybeBroadcastSession(
	session *SigningSession,
	proposedTransaction *ProposedTransaction,
	signer string,
) (*SigningSession, error) {
	if !containsSigner(session.SignedBy, signer) {
		session.SignedBy = append(session.SignedBy, signer)
	}
	session.MissingSigners = removeSigner(session.MissingSigners, signer)
	session.UpdatedAt = time.Now()

	psbtBytes, err := serializePSBT(proposedTransaction.TXProposal.Psbt)
	if err != nil {
		return nil, err
	}
	session.PSBT = psbtBytes

	if len(session.SignedBy) < session.Threshold {
		session.State = SigningSessionStatePartiallySigned
		if err := account.saveSigningSession(session); err != nil {
			return nil, err
		}
		return session, nil
	}

	signedTx, err := proposedTransaction.FinalizeAndExtract()
	if err != nil {
		return nil, err
	}
	if err := account.coin.Blockchain().TransactionBroadcast(signedTx); err != nil {
		session.State = SigningSessionStateReadyToBroadcast
		finalizedPSBT, serializeErr := serializePSBT(proposedTransaction.TXProposal.Psbt)
		if serializeErr == nil {
			session.PSBT = finalizedPSBT
		}
		if saveErr := account.saveSigningSession(session); saveErr != nil {
			account.log.WithError(saveErr).Error("failed to persist ready-to-broadcast session")
		}
		account.log.WithError(err).Warn("failed to broadcast fully signed vault transaction")
		return session, nil
	}

	session.State = SigningSessionStateBroadcasted
	session.TxID = signedTx.TxID()
	if err := account.SetTxNote(session.TxID, session.Note); err != nil {
		account.log.WithError(err).Error("failed to persist note for broadcasted vault transaction")
	}
	finalizedPSBT, err := serializePSBT(proposedTransaction.TXProposal.Psbt)
	if err == nil {
		session.PSBT = finalizedPSBT
	}
	if err := account.saveSigningSession(session); err != nil {
		return nil, err
	}
	return session, nil
}

func (account *Account) SignSigningSession(id string) (*SigningSession, error) {
	session, err := account.loadSigningSession(id)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, errp.Newf("signing session %s not found", id)
	}
	if session.State == SigningSessionStateBroadcasted || session.State == SigningSessionStateAbandoned {
		return nil, errp.New("signing session can no longer be signed")
	}
	keystore, signer, err := account.connectVaultSigner(session.MissingSigners)
	if err != nil {
		return nil, err
	}
	if containsSigner(session.SignedBy, signer) {
		return nil, errp.New("connected signer already signed this transaction")
	}
	proposedTransaction, err := account.proposedTransactionFromSession(session)
	if err != nil {
		return nil, err
	}
	if err := proposedTransaction.Update(); err != nil {
		return nil, err
	}

	// Save existing partial signatures before signing, as BTCSignPSBT replaces
	// (rather than appends to) partial sigs per input.
	existingPartialSigs := make([][]*psbt.PartialSig, len(proposedTransaction.TXProposal.Psbt.Inputs))
	for i, input := range proposedTransaction.TXProposal.Psbt.Inputs {
		existingPartialSigs[i] = make([]*psbt.PartialSig, len(input.PartialSigs))
		copy(existingPartialSigs[i], input.PartialSigs)
	}

	if err := keystore.SignTransaction(proposedTransaction); err != nil {
		return nil, err
	}

	// Merge previously collected signatures back into the PSBT.
	for i, input := range proposedTransaction.TXProposal.Psbt.Inputs {
		newSigs := input.PartialSigs
		merged := make([]*psbt.PartialSig, 0, len(existingPartialSigs[i])+len(newSigs))
		merged = append(merged, existingPartialSigs[i]...)
		for _, newSig := range newSigs {
			alreadyPresent := false
			for _, existingSig := range existingPartialSigs[i] {
				if bytes.Equal(existingSig.PubKey, newSig.PubKey) {
					alreadyPresent = true
					break
				}
			}
			if !alreadyPresent {
				merged = append(merged, newSig)
			}
		}
		proposedTransaction.TXProposal.Psbt.Inputs[i].PartialSigs = merged
	}

	return account.signAndMaybeBroadcastSession(session, proposedTransaction, signer)
}

func (account *Account) BroadcastSigningSession(id string) (*SigningSession, error) {
	session, err := account.loadSigningSession(id)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, errp.Newf("signing session %s not found", id)
	}
	if session.State == SigningSessionStateBroadcasted {
		return session, nil
	}
	if len(session.SignedBy) < session.Threshold {
		return nil, errp.New("signing session does not have enough signatures yet")
	}
	proposedTransaction, err := account.proposedTransactionFromSession(session)
	if err != nil {
		return nil, err
	}
	if err := proposedTransaction.Update(); err != nil {
		return nil, err
	}
	signedTx, err := proposedTransaction.FinalizeAndExtract()
	if err != nil {
		return nil, err
	}
	if err := account.coin.Blockchain().TransactionBroadcast(signedTx); err != nil {
		return nil, err
	}
	session.State = SigningSessionStateBroadcasted
	session.TxID = signedTx.TxID()
	session.UpdatedAt = time.Now()
	if err := account.SetTxNote(session.TxID, session.Note); err != nil {
		account.log.WithError(err).Error("failed to persist note for broadcasted vault transaction")
	}
	finalizedPSBT, err := serializePSBT(proposedTransaction.TXProposal.Psbt)
	if err == nil {
		session.PSBT = finalizedPSBT
	}
	if err := account.saveSigningSession(session); err != nil {
		return nil, err
	}
	return session, nil
}

func (account *Account) AbandonSigningSession(id string) (*SigningSession, error) {
	session, err := account.loadSigningSession(id)
	if err != nil {
		return nil, err
	}
	if session == nil {
		return nil, errp.Newf("signing session %s not found", id)
	}
	session.State = SigningSessionStateAbandoned
	session.UpdatedAt = time.Now()
	if err := account.saveSigningSession(session); err != nil {
		return nil, err
	}
	return session, nil
}
