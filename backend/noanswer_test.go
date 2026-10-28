package main

import "testing"

func TestNoAnswerReasonSpellings(t *testing.T) {
	for _, reason := range []string{"no-answer", "no_answer", "NO_ANSWER", "busy", "rejected"} {
		check(t, noAnswerSignal("failed", reason) != "", "%s not read as no answer", reason)
		check(t, retryKind(obj{"status": "failed", "reason": reason}) == "noanswer", "%s retried as a line failure", reason)
	}
	check(t, noAnswerSignal("failed", "unreachable") == "", "unreachable read as no answer")
	check(t, retryKind(obj{"status": "failed", "reason": "unreachable"}) == "unreachable", "unreachable kind changed")
}
