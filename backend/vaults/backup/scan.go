// SPDX-License-Identifier: Apache-2.0

package backup

import (
	coinpkg "github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/coin"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/btc/blockchain"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/errp"
	"github.com/btcsuite/btcd/btcutil/hdkeychain"
	"github.com/btcsuite/btcd/chaincfg/chainhash"
)

const (
	// MaxAccountScan is the maximum number of account numbers to try during recovery.
	MaxAccountScan = 5
)

// ScanResult contains a successfully recovered descriptor and metadata.
type ScanResult struct {
	Descriptor    string
	AccountNumber uint16
	SlotIndex     int
	TxHash        chainhash.Hash
}

// ScanForBackup searches the blockchain for an on-chain vault backup using a single xpub.
// It derives the beacon address for the participant, queries Electrum for transactions,
// and attempts to extract and decrypt the descriptor from each.
func ScanForBackup(
	bc blockchain.Interface,
	network coinpkg.Code,
	xpub *hdkeychain.ExtendedKey,
) (*ScanResult, error) {
	beacon, err := ComputeBeaconAddress(network, xpub)
	if err != nil {
		return nil, errp.Wrap(err, "failed to compute beacon address")
	}

	history, err := bc.ScriptHashGetHistory(beacon.ScriptHashHex)
	if err != nil {
		return nil, errp.Wrap(err, "failed to query beacon address history")
	}

	for _, txInfo := range history {
		// Only consider confirmed transactions.
		if txInfo.Height <= 0 {
			continue
		}

		txHash := txInfo.TXHash.Hash()
		tx, err := bc.TransactionGet(txHash)
		if err != nil {
			continue // skip unretrievable transactions
		}

		payload := ParseOPReturnPayload(tx)
		if payload == nil {
			continue // not a backup tx
		}

		descriptor, accountNumber, slotIdx, err := TryDecryptDescriptor(payload, network, xpub)
		if err != nil {
			continue // wrong keys or corrupted
		}

		return &ScanResult{
			Descriptor:    descriptor,
			AccountNumber: accountNumber,
			SlotIndex:     slotIdx,
			TxHash:        txHash,
		}, nil
	}

	return nil, errp.New("no on-chain backup found for this xpub")
}

// BackupStatus holds the result of checking for an on-chain backup.
type BackupStatus struct {
	Found     bool
	Confirmed bool
	TxHash    chainhash.Hash
}

// CheckBackupExists checks whether an on-chain backup exists for a given vault's beacon addresses.
// Returns found/confirmed status and the tx hash. Also detects unconfirmed (mempool) backups.
func CheckBackupExists(
	bc blockchain.Interface,
	network coinpkg.Code,
	xpubs [3]*hdkeychain.ExtendedKey,
) (*BackupStatus, error) {
	// Check any single beacon - if the backup tx exists, all 3 beacons will have received funds.
	beacon, err := ComputeBeaconAddress(network, xpubs[0])
	if err != nil {
		return nil, errp.Wrap(err, "failed to compute beacon")
	}

	history, err := bc.ScriptHashGetHistory(beacon.ScriptHashHex)
	if err != nil {
		return nil, errp.Wrap(err, "failed to query beacon history")
	}

	for _, txInfo := range history {
		txHash := txInfo.TXHash.Hash()
		tx, err := bc.TransactionGet(txHash)
		if err != nil {
			continue
		}
		if ParseOPReturnPayload(tx) != nil {
			return &BackupStatus{
				Found:     true,
				Confirmed: txInfo.Height > 0,
				TxHash:    txHash,
			}, nil
		}
	}

	return &BackupStatus{}, nil
}
