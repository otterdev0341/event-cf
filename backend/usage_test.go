package main

import "testing"

func TestUsageAgentAllowed(t *testing.T) {
	call := func(agentID any) any { return obj{"id": "oc_1", "agent": obj{"id": agentID}} }
	allowed := []string{"agt_a", "agt_b"}
	check(t, usageAgentAllowed(call("agt_x"), nil), "empty list must keep every call")
	check(t, usageAgentAllowed(call("agt_b"), allowed), "allowed agent dropped")
	check(t, !usageAgentAllowed(call("agt_x"), allowed), "other agent counted")
	check(t, !usageAgentAllowed(obj{"id": "oc_2"}, allowed), "call without agent counted")
}
