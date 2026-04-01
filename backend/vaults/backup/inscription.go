// SPDX-License-Identifier: Apache-2.0

package backup

import (
	"bytes"

	"github.com/btcsuite/btcd/txscript"
	"github.com/btcsuite/btcd/wire"
)

const (
	// ProtocolTag is the 4-byte identifier embedded in OP_RETURN outputs to identify vault backups.
	ProtocolTag = "bvb1"

	// BeaconDust is the minimum output value for beacon taproot (P2TR) outputs.
	// The Taproot dust threshold is 330 sats (lower than the 546-sat legacy threshold).
	BeaconDust = 330
)

// BuildOPReturnScript builds an OP_RETURN script containing the protocol tag and encrypted payload.
// The tag and payload are concatenated into a single data push: OP_RETURN <"bvb1" || payload>
func BuildOPReturnScript(payload []byte) ([]byte, error) {
	data := append([]byte(ProtocolTag), payload...)
	builder := txscript.NewScriptBuilder()
	builder.AddOp(txscript.OP_RETURN)
	builder.AddData(data)
	return builder.Script()
}

// ParseOPReturnPayload extracts the backup payload from a transaction's OP_RETURN output.
// It looks for an output with OP_RETURN <"bvb1"> <data> and returns the data.
// Returns nil if no valid backup OP_RETURN is found.
func ParseOPReturnPayload(tx *wire.MsgTx) []byte {
	for _, txOut := range tx.TxOut {
		if payload := parseOPReturnScript(txOut.PkScript); payload != nil {
			return payload
		}
	}
	return nil
}

// parseOPReturnScript attempts to parse a vault backup payload from an OP_RETURN script.
// The data push format is: <"bvb1" || payload> (tag and payload concatenated in a single push).
func parseOPReturnScript(script []byte) []byte {
	tokenizer := txscript.MakeScriptTokenizer(0, script)

	// Expect OP_RETURN.
	if !tokenizer.Next() || tokenizer.Opcode() != txscript.OP_RETURN {
		return nil
	}
	// Expect single data push containing tag + payload.
	if !tokenizer.Next() {
		return nil
	}
	data := tokenizer.Data()
	tag := []byte(ProtocolTag)
	if len(data) <= len(tag) || !bytes.Equal(data[:len(tag)], tag) {
		return nil
	}
	return data[len(tag):]
}
