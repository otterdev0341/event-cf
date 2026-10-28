package main

// Helpers that reproduce JavaScript semantics the Node server relied on.
// Hashes, fingerprints, length limits and timestamps must match the Node output,
// so these stay deliberately close to the ECMAScript definitions.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"maps"
	"sort"
	"strconv"
	"strings"
	"time"
)

// obj is a decoded JSON object; JSON values decode to nil, bool, float64, string, []any or obj.
type obj = map[string]any

// kv/ordered keep insertion order when an object is hashed with jsStringify.
type kv struct {
	k string
	v any
}
type ordered []kv

func get(v any, keys ...string) any {
	for _, k := range keys {
		m, ok := v.(obj)
		if !ok {
			return nil
		}
		v = m[k]
	}
	return v
}

func has(v any, key string) bool {
	m, ok := v.(obj)
	if !ok {
		return false
	}
	_, ok = m[key]
	return ok
}

func str(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok
}

// strOr returns v when it is a string, otherwise "".
func strOr(v any) string {
	s, _ := v.(string)
	return s
}

func isObject(v any) bool {
	_, ok := v.(obj)
	return ok
}

func array(v any) ([]any, bool) {
	a, ok := v.([]any)
	return a, ok
}

// truthy mirrors JavaScript truthiness for decoded JSON values.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0 && x == x
	case string:
		return x != ""
	}
	return true
}

// jsInt reports whether v is a JSON number with an integer value (Number.isInteger).
func jsInt(v any) (int, bool) {
	f, ok := v.(float64)
	if !ok || f != float64(int64(f)) || f > 1<<53 || f < -(1<<53) {
		return 0, false
	}
	return int(f), true
}

// objOr returns a shallow copy of v when it is an object, like {...(v || {})}.
func objOr(v any) obj {
	if m, ok := v.(obj); ok {
		return maps.Clone(m)
	}
	return obj{}
}

// jsLen is String.prototype.length: UTF-16 code units.
func jsLen(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

// jsSlice is s.slice(0, n) in UTF-16 units; a pair split at the edge is dropped.
func jsSlice(s string, n int) string {
	units := 0
	for i, r := range s {
		w := 1
		if r >= 0x10000 {
			w = 2
		}
		if units+w > n {
			return s[:i]
		}
		units += w
	}
	return s
}

// isJSSpace matches the ECMAScript WhiteSpace and LineTerminator sets (\s and trim).
func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	}
	return r >= 0x2000 && r <= 0x200A
}

func jsTrim(s string) string { return strings.TrimFunc(s, isJSSpace) }

// removeChars deletes JS whitespace plus the given extra characters, like s.replace(/[\s...]/g, ”).
func removeChars(s, extra string) string {
	return strings.Map(func(r rune) rune {
		if isJSSpace(r) || strings.ContainsRune(extra, r) {
			return -1
		}
		return r
	}, s)
}

// jsStringify reproduces JSON.stringify for decoded JSON values, ordered objects and obj.
// obj keys are written sorted; callers that need insertion order pass ordered.
func jsStringify(v any) string {
	var b strings.Builder
	writeJS(&b, v)
	return b.String()
}

func writeJS(b *strings.Builder, v any) {
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		b.WriteString(strconv.FormatBool(x))
	case float64:
		out, _ := json.Marshal(x) // encoding/json formats floats like ES6 Number#toString
		b.Write(out)
	case int:
		b.WriteString(strconv.Itoa(x))
	case string:
		writeJSString(b, x)
	case []any:
		b.WriteByte('[')
		for i, item := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			writeJS(b, item)
		}
		b.WriteByte(']')
	case []string:
		b.WriteByte('[')
		for i, item := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			writeJSString(b, item)
		}
		b.WriteByte(']')
	case ordered:
		b.WriteByte('{')
		for i, p := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			writeJSString(b, p.k)
			b.WriteByte(':')
			writeJS(b, p.v)
		}
		b.WriteByte('}')
	case obj:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			writeJSString(b, k)
			b.WriteByte(':')
			writeJS(b, x[k])
		}
		b.WriteByte('}')
	default:
		out, _ := json.Marshal(x)
		b.Write(out)
	}
}

func writeJSString(b *strings.Builder, s string) {
	const hexDigits = "0123456789abcdef"
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				b.WriteString(`\u00`)
				b.WriteByte(hexDigits[r>>4])
				b.WriteByte(hexDigits[r&15])
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// jsDateParse handles the ISO 8601 forms Date.parse sees here, at millisecond precision.
// Date-only and zone-less values are read as UTC (the Node server ran with TZ=UTC).
func jsDateParse(v any) (int64, bool) {
	s, ok := v.(string)
	if !ok {
		return 0, false
	}
	for _, layout := range []string{
		"2006-01-02T15:04:05.999999999Z07:00", "2006-01-02T15:04:05.999999999Z07",
		"2006-01-02 15:04:05.999999999Z07:00", "2006-01-02 15:04:05.999999999Z07",
		"2006-01-02T15:04:05.999999999", "2006-01-02T15:04", "2006-01-02",
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UnixMilli(), true
		}
	}
	return 0, false
}

// jsISO is Date#toISOString.
func jsISO(ms int64) string {
	return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z")
}

func nowISO() string { return jsISO(time.Now().UnixMilli()) }

func nowMS() int64 { return time.Now().UnixMilli() }
