package auth

import "testing"

func TestMapRoleHighestWins(t *testing.T) {
	mapping := RoleMapping{
		Admin:  []string{"dashglass-admins"},
		Editor: []string{"family", "dev"},
		Viewer: []string{"*"},
	}
	cases := []struct {
		groups []string
		want   Role
		ok     bool
	}{
		{[]string{"dashglass-admins", "family"}, RoleAdmin, true}, // highest wins
		{[]string{"dev"}, RoleEditor, true},
		{[]string{"random"}, RoleViewer, true},   // "*" catches anyone
		{nil, RoleViewer, true},                  // "*" catches groupless too
	}
	for _, c := range cases {
		role, ok := mapping.MapRole(c.groups)
		if ok != c.ok || role != c.want {
			t.Errorf("MapRole(%v) = %q,%v want %q,%v", c.groups, role, ok, c.want, c.ok)
		}
	}
}

func TestMapRoleDenyByDefault(t *testing.T) {
	// No "*": groups outside the lists get nothing (403, not viewer).
	mapping := RoleMapping{Admin: []string{"admins"}, Editor: []string{"devs"}}
	if _, ok := mapping.MapRole([]string{"guests"}); ok {
		t.Error("unmapped group should be denied")
	}
	if _, ok := mapping.MapRole(nil); ok {
		t.Error("no groups should be denied without '*'")
	}
	if role, ok := mapping.MapRole([]string{"admins"}); !ok || role != RoleAdmin {
		t.Errorf("mapped group = %q,%v", role, ok)
	}
}
