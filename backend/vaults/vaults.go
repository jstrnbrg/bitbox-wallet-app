// SPDX-License-Identifier: Apache-2.0

package vaults

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"time"

	coinpkg "github.com/BitBoxSwiss/bitbox-wallet-app/backend/coins/coin"
	"github.com/BitBoxSwiss/bitbox-wallet-app/backend/signing"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/errp"
	"github.com/BitBoxSwiss/bitbox-wallet-app/util/random"
	"go.etcd.io/bbolt"
)

const (
	// PolicyTemplate2Of3 is the fixed v1 vault policy template.
	PolicyTemplate2Of3 = "wsh(sortedmulti(2,@0,@1,@2))"

	// RecoveryFormatV1 is the current vault recovery export/import format.
	RecoveryFormatV1 = "bitbox-vault-recovery-v1"
)

// DraftState models the persisted vault setup draft state.
type DraftState string

const (
	DraftStateCollectingSigners DraftState = "collectingSigners"
	DraftStateReadyForBackup    DraftState = "readyForBackup"
	DraftStateReadyToComplete   DraftState = "readyToComplete"
	DraftStateCompleted         DraftState = "completed"
	DraftStateDiscarded         DraftState = "discarded"
)

// Draft models a persisted vault setup draft.
type Draft struct {
	ID                   string                             `json:"id"`
	Network              coinpkg.Code                       `json:"network"`
	Name                 string                             `json:"name"`
	AccountNumber        uint16                             `json:"accountNumber"`
	AccountKeypath       signing.AbsoluteKeypath            `json:"accountKeypath"`
	Participants         []signing.BitcoinPolicyParticipant `json:"participants"`
	State                DraftState                         `json:"state"`
	CreatedAt            time.Time                          `json:"createdAt"`
	UpdatedAt            time.Time                          `json:"updatedAt"`
	RecoveryAcknowledged bool                               `json:"recoveryAcknowledged"`
	PolicyID             string                             `json:"policyId,omitempty"`
}

// RecoveryFile models the exported/imported vault recovery file.
type RecoveryFile struct {
	Format         string                             `json:"format"`
	Network        coinpkg.Code                       `json:"network"`
	Policy         string                             `json:"policy"`
	Descriptor     string                             `json:"descriptor"`
	Threshold      int                                `json:"threshold"`
	ScriptType     signing.ScriptType                 `json:"scriptType"`
	PolicyID       string                             `json:"policyId"`
	AccountNumber  uint16                             `json:"accountNumber"`
	AccountKeypath signing.AbsoluteKeypath            `json:"accountKeypath"`
	Participants   []signing.BitcoinPolicyParticipant `json:"participants"`
	Descriptors    struct {
		Receive string `json:"receive"`
		Change  string `json:"change"`
	} `json:"descriptors"`
	CreatedAt time.Time `json:"createdAt"`
}

func participantDescriptorFragment(participant signing.BitcoinPolicyParticipant) string {
	return fmt.Sprintf(
		"%x|%s|%s",
		participant.KeyInfo.RootFingerprint,
		participant.KeyInfo.AbsoluteKeypath.Encode(),
		participant.KeyInfo.ExtendedPublicKey.String(),
	)
}

func participantDescriptorKeyString(participant signing.BitcoinPolicyParticipant) string {
	return fmt.Sprintf(
		"[%x/%s]%s",
		participant.KeyInfo.RootFingerprint,
		strings.TrimPrefix(participant.KeyInfo.AbsoluteKeypath.Encode(), "m/"),
		participant.KeyInfo.ExtendedPublicKey.String(),
	)
}

// CanonicalizeParticipants sorts participants deterministically.
func CanonicalizeParticipants(
	participants []signing.BitcoinPolicyParticipant,
) []signing.BitcoinPolicyParticipant {
	result := slices.Clone(participants)
	slices.SortFunc(result, func(a, b signing.BitcoinPolicyParticipant) int {
		return strings.Compare(participantDescriptorFragment(a), participantDescriptorFragment(b))
	})
	return result
}

// BIP48AccountKeypath returns the account-level BIP48 path for a vault.
func BIP48AccountKeypath(coinCode coinpkg.Code, accountNumber uint16) signing.AbsoluteKeypath {
	coinType := uint32(1)
	if coinCode == coinpkg.CodeBTC {
		coinType = 0
	}
	return signing.NewAbsoluteKeypathFromUint32(
		48+0x80000000,
		coinType+0x80000000,
		uint32(accountNumber)+0x80000000,
		2+0x80000000,
	)
}

// ComputePolicyID returns a stable identifier for a canonical participant set.
func ComputePolicyID(
	network coinpkg.Code,
	policy string,
	threshold int,
	scriptType signing.ScriptType,
	accountKeypath signing.AbsoluteKeypath,
	participants []signing.BitcoinPolicyParticipant,
) string {
	h := sha256.New()
	_, _ = h.Write([]byte(network))
	_, _ = h.Write([]byte{0})
	_, _ = h.Write([]byte(policy))
	_, _ = h.Write([]byte{0})
	_, _ = h.Write([]byte(fmt.Sprintf("%d|%s|%s", threshold, scriptType, accountKeypath.Encode())))
	for _, participant := range CanonicalizeParticipants(participants) {
		_, _ = h.Write([]byte{0})
		_, _ = h.Write([]byte(participantDescriptorFragment(participant)))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// AccountDescriptor returns the canonical multipath descriptor for the vault account.
func AccountDescriptor(participants []signing.BitcoinPolicyParticipant) string {
	keys := make([]string, len(participants))
	for i, participant := range CanonicalizeParticipants(participants) {
		keys[i] = participantDescriptorKeyString(participant) + "/<0;1>/*"
	}
	return fmt.Sprintf("wsh(sortedmulti(2,%s))", strings.Join(keys, ","))
}

func descriptorForChain(chainIndex uint32, participants []signing.BitcoinPolicyParticipant) string {
	keys := make([]string, len(participants))
	for i, participant := range CanonicalizeParticipants(participants) {
		keys[i] = participantDescriptorKeyString(participant) + fmt.Sprintf("/%d/*", chainIndex)
	}
	return fmt.Sprintf("wsh(sortedmulti(2,%s))", strings.Join(keys, ","))
}

// RecoveryFileFromDraft builds a recovery file from a completed draft.
func RecoveryFileFromDraft(draft *Draft) *RecoveryFile {
	canonicalParticipants := CanonicalizeParticipants(draft.Participants)
	policyID := ComputePolicyID(
		draft.Network,
		PolicyTemplate2Of3,
		2,
		signing.ScriptTypeP2WSH,
		draft.AccountKeypath,
		canonicalParticipants,
	)
	recovery := &RecoveryFile{
		Format:         RecoveryFormatV1,
		Network:        draft.Network,
		Policy:         PolicyTemplate2Of3,
		Descriptor:     AccountDescriptor(canonicalParticipants),
		Threshold:      2,
		ScriptType:     signing.ScriptTypeP2WSH,
		PolicyID:       policyID,
		AccountNumber:  draft.AccountNumber,
		AccountKeypath: draft.AccountKeypath,
		Participants:   canonicalParticipants,
		CreatedAt:      draft.CreatedAt,
	}
	recovery.Descriptors.Receive = descriptorForChain(0, canonicalParticipants)
	recovery.Descriptors.Change = descriptorForChain(1, canonicalParticipants)
	return recovery
}

var bucketDrafts = []byte("drafts")

// Store persists vault setup drafts in an app-scoped BoltDB.
type Store struct {
	db *bbolt.DB
}

// NewStore opens the vault setup draft store.
func NewStore(cacheDir string) (*Store, error) {
	db, err := bbolt.Open(filepath.Join(cacheDir, "vault-setup-drafts.db"), 0600, nil)
	if err != nil {
		return nil, errp.WithStack(err)
	}
	return &Store{db: db}, nil
}

// Close closes the underlying DB.
func (store *Store) Close() error {
	return errp.WithStack(store.db.Close())
}

func randomID() string {
	return hex.EncodeToString(random.BytesOrPanic(16))
}

// CreateDraft creates and persists a new vault setup draft.
func (store *Store) CreateDraft(network coinpkg.Code, accountNumber uint16, name string) (*Draft, error) {
	now := time.Now()
	draft := &Draft{
		ID:             randomID(),
		Network:        network,
		Name:           name,
		AccountNumber:  accountNumber,
		AccountKeypath: BIP48AccountKeypath(network, accountNumber),
		Participants:   []signing.BitcoinPolicyParticipant{},
		State:          DraftStateCollectingSigners,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	return draft, store.SaveDraft(draft)
}

// SaveDraft persists a draft.
func (store *Store) SaveDraft(draft *Draft) error {
	draft.UpdatedAt = time.Now()
	return store.db.Update(func(tx *bbolt.Tx) error {
		bucket, err := tx.CreateBucketIfNotExists(bucketDrafts)
		if err != nil {
			return errp.WithStack(err)
		}
		return writeJSON(bucket, []byte(draft.ID), draft)
	})
}

// GetDraft returns a draft by id.
func (store *Store) GetDraft(id string) (*Draft, error) {
	var draft Draft
	err := store.db.View(func(tx *bbolt.Tx) error {
		bucket := tx.Bucket(bucketDrafts)
		found, err := readJSON(bucket, []byte(id), &draft)
		if err != nil {
			return err
		}
		if !found {
			return errp.New("vault draft not found")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if draft.Participants == nil {
		draft.Participants = []signing.BitcoinPolicyParticipant{}
	}
	return &draft, nil
}

// ListDrafts returns all non-discarded drafts.
func (store *Store) ListDrafts() ([]*Draft, error) {
	result := []*Draft{}
	err := store.db.View(func(tx *bbolt.Tx) error {
		bucket := tx.Bucket(bucketDrafts)
		if bucket == nil {
			return nil
		}
		return bucket.ForEach(func(_, value []byte) error {
			var draft Draft
			if err := errp.WithStack(json.Unmarshal(value, &draft)); err != nil {
				return err
			}
			if draft.Participants == nil {
				draft.Participants = []signing.BitcoinPolicyParticipant{}
			}
			if draft.State != DraftStateDiscarded && draft.State != DraftStateCompleted {
				result = append(result, &draft)
			}
			return nil
		})
	})
	if err != nil {
		return nil, err
	}
	slices.SortFunc(result, func(a, b *Draft) int {
		if a.UpdatedAt.Equal(b.UpdatedAt) {
			return strings.Compare(a.ID, b.ID)
		}
		if a.UpdatedAt.After(b.UpdatedAt) {
			return -1
		}
		return 1
	})
	return result, nil
}

// DeleteDraft deletes a draft.
func (store *Store) DeleteDraft(id string) error {
	return store.db.Update(func(tx *bbolt.Tx) error {
		bucket, err := tx.CreateBucketIfNotExists(bucketDrafts)
		if err != nil {
			return errp.WithStack(err)
		}
		return errp.WithStack(bucket.Delete([]byte(id)))
	})
}

func readJSON(bucket *bbolt.Bucket, key []byte, value interface{}) (bool, error) {
	if bucket == nil {
		return false, nil
	}
	if jsonBytes := bucket.Get(key); jsonBytes != nil {
		return true, errp.WithStack(json.Unmarshal(jsonBytes, value))
	}
	return false, nil
}

func writeJSON(bucket *bbolt.Bucket, key []byte, value interface{}) error {
	jsonBytes, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return errp.WithStack(bucket.Put(key, jsonBytes))
}
