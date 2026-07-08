package auth

// RoleMapping maps identity-provider groups to Dashglass roles. It is shared
// by every external provider (reverse proxy now, OIDC later): the highest
// matching role wins, "*" matches any authenticated user, and no match
// means access is denied (DESIGN.md §7.4).
type RoleMapping struct {
	Admin  []string `yaml:"admin"`
	Editor []string `yaml:"editor"`
	Viewer []string `yaml:"viewer"`
}

// MapRole resolves a user's groups to a role. ok is false when no rule
// matches — the caller must then deny access (403), never default to
// viewer, so a shared IdP grants nothing until a mapping says so.
func (m RoleMapping) MapRole(groups []string) (Role, bool) {
	// Highest role first: the first tier that matches wins.
	for _, tier := range []struct {
		role   Role
		groups []string
	}{
		{RoleAdmin, m.Admin},
		{RoleEditor, m.Editor},
		{RoleViewer, m.Viewer},
	} {
		if matchesGroups(tier.groups, groups) {
			return tier.role, true
		}
	}
	return "", false
}

// matchesGroups reports whether any rule group matches: "*" matches any
// authenticated user (even with no groups), otherwise a listed group must
// be present.
func matchesGroups(rule, userGroups []string) bool {
	for _, want := range rule {
		if want == "*" {
			return true
		}
		for _, have := range userGroups {
			if have == want {
				return true
			}
		}
	}
	return false
}
