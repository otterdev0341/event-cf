package main

import "testing"

// Golden values produced by server/connection.mjs (Node) with these inputs.
const (
	goldenKey       = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="
	goldenOwner     = "11111111-1111-4111-8111-111111111111"
	goldenToken     = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig-ñ"
	goldenSealed    = "v1.40b8njN+Q7UGas20.JAw01Qm+jTqBeK/DsqAqFw==./9XqrXFoL21Cs+9MGlF6hW7/2LR1MQGJ1UUf1px/YP2W4bZ4mPDge91TEg=="
	goldenSecret    = "callback-fixture-secret-longer-than-32"
	goldenResult    = "mL35tsTBO6LJBovHq9WhgkgoSm32Lapf9dyzp9CKA2c"
	goldenRecording = "gLrjux7Z55Nzaxo_hifsEY1OhlYJscz725KP6u5kkCU"
)

func TestOpenNodeSealedToken(t *testing.T) {
	got, err := openToken(goldenSealed, goldenOwner, goldenKey)
	if err != nil || got != goldenToken {
		t.Fatalf("openToken = %q, %v", got, err)
	}
}

func TestSealRoundTripAndOwnerBinding(t *testing.T) {
	sealed, err := sealToken(goldenToken, goldenOwner, goldenKey)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := openToken(sealed, goldenOwner, goldenKey); err != nil || got != goldenToken {
		t.Fatalf("round trip = %q, %v", got, err)
	}
	if _, err := openToken(sealed, "22222222-2222-4222-8222-222222222222", goldenKey); err == nil {
		t.Fatal("token opened for a different owner")
	}
}

func TestRejectsBadInput(t *testing.T) {
	for _, v := range []string{"", "v2.a.b.c", "v1.a.b", "v1.a.b.c.d", goldenSealed[:len(goldenSealed)-4] + "AAA="} {
		if _, err := openToken(v, goldenOwner, goldenKey); err == nil {
			t.Errorf("openToken accepted %q", v)
		}
	}
	for _, k := range []string{"", "short", goldenKey[:43]} {
		if _, err := sealToken("x", goldenOwner, k); err == nil {
			t.Errorf("sealToken accepted key %q", k)
		}
	}
	if _, err := accountCallbackSecret("acct_123", "too-short"); err == nil {
		t.Error("accepted short callback secret")
	}
	if _, err := accountCallbackSecret("", goldenSecret); err == nil {
		t.Error("accepted empty account id")
	}
}

func TestAccountSecretsMatchNode(t *testing.T) {
	if got, _ := accountCallbackSecret("acct_123", goldenSecret); got != goldenResult {
		t.Errorf("result secret = %q", got)
	}
	if got, _ := accountRecordingSecret("acct_123", goldenSecret); got != goldenRecording {
		t.Errorf("recording secret = %q", got)
	}
}
