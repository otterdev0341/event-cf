package main

import "testing"

func user(role string) obj {
	meta := obj{}
	if role != "" {
		meta["role"] = role
	}
	return obj{"id": role + "-user", "email": role + "@example.com", "app_metadata": meta}
}

func TestRoleOfDefaultsToAdmin(t *testing.T) {
	if roleOf(user("dev")) != "dev" || roleOf(user("admin")) != "admin" || roleOf(user("")) != "admin" {
		t.Fatal("roleOf must return dev only for app_metadata.role == dev")
	}
	// user_metadata is editable by the user, so it must never grant dev.
	if roleOf(obj{"user_metadata": obj{"role": "dev"}}) != "admin" {
		t.Fatal("user_metadata must not grant dev")
	}
}

func TestValidRole(t *testing.T) {
	for _, ok := range []string{"dev", "admin"} {
		if !validRole(ok) {
			t.Fatalf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"", "root", "Dev", "dev "} {
		if validRole(bad) {
			t.Fatalf("%q should be invalid", bad)
		}
	}
}

func TestCannotRemoveLastDev(t *testing.T) {
	one := []any{user("dev"), user("admin")}
	if canChangeRole(user("dev"), "admin", one) {
		t.Fatal("the last dev must not be demoted")
	}
	two := []any{user("dev"), user("dev"), user("admin")}
	if !canChangeRole(user("dev"), "admin", two) {
		t.Fatal("a dev can be demoted when another dev remains")
	}
	if !canChangeRole(user("admin"), "dev", one) || !canChangeRole(user("dev"), "dev", one) {
		t.Fatal("promoting or keeping dev is always allowed")
	}
}

func TestPublicUsersHidesMetadata(t *testing.T) {
	out := publicUsers([]any{obj{"id": "1", "email": "a@b.c", "app_metadata": obj{"role": "dev", "secret": "x"}, "identities": []any{1}}})
	row := out[0].(obj)
	if row["role"] != "dev" || row["email"] != "a@b.c" {
		t.Fatalf("unexpected row %v", row)
	}
	if _, leaked := row["app_metadata"]; leaked {
		t.Fatal("app_metadata must not be sent to the browser")
	}
	if _, leaked := row["identities"]; leaked {
		t.Fatal("identities must not be sent to the browser")
	}
}
