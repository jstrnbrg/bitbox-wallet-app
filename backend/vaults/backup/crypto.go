// SPDX-License-Identifier: Apache-2.0

package backup

import (
	"crypto/hmac"
	"crypto/sha256"
)

// hmacSHA256 computes HMAC-SHA256(key, data).
func hmacSHA256(key, data []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}
