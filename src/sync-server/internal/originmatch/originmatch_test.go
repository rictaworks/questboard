package originmatch_test

import (
	"testing"

	"github.com/rictaworks/questboard/src/sync-server/internal/originmatch"
)

func TestDevelopmentPatternReturnsNilWhenEitherInputIsBlank(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name             string
		codespaceName    string
		forwardingDomain string
	}{
		{"both blank", "", ""},
		{"codespace name blank", "", "app.github.dev"},
		{"forwarding domain blank", "curly-journey-gxq7gpgxwwj73j6w", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			pattern, err := originmatch.DevelopmentPattern(tc.codespaceName, tc.forwardingDomain)
			if err != nil {
				t.Fatalf("DevelopmentPattern() error = %v", err)
			}
			if pattern != nil {
				t.Fatalf("DevelopmentPattern() = %v, want nil", pattern)
			}
		})
	}
}

func TestDevelopmentPatternMatchesAnyForwardedPortUnderTheCodespace(t *testing.T) {
	t.Parallel()

	pattern, err := originmatch.DevelopmentPattern("curly-journey-gxq7gpgxwwj73j6w", "app.github.dev")
	if err != nil {
		t.Fatalf("DevelopmentPattern() error = %v", err)
	}
	if pattern == nil {
		t.Fatal("DevelopmentPattern() = nil, want a compiled pattern")
	}

	matches := []string{
		"https://curly-journey-gxq7gpgxwwj73j6w-3100.app.github.dev",
		"https://curly-journey-gxq7gpgxwwj73j6w-8080.app.github.dev",
	}
	for _, origin := range matches {
		if !pattern.MatchString(origin) {
			t.Errorf("pattern did not match %q", origin)
		}
	}
}

func TestDevelopmentPatternRejectsOtherCodespacesAndSpoofedOrigins(t *testing.T) {
	t.Parallel()

	pattern, err := originmatch.DevelopmentPattern("curly-journey-gxq7gpgxwwj73j6w", "app.github.dev")
	if err != nil {
		t.Fatalf("DevelopmentPattern() error = %v", err)
	}

	rejections := []string{
		"https://someone-elses-codespace-3100.app.github.dev",
		"https://curly-journey-gxq7gpgxwwj73j6w-3100.app.github.dev.evil-attacker.com",
		"https://evil-attacker.com/curly-journey-gxq7gpgxwwj73j6w-3100.app.github.dev",
		"http://curly-journey-gxq7gpgxwwj73j6w-3100.app.github.dev",
	}
	for _, origin := range rejections {
		if pattern.MatchString(origin) {
			t.Errorf("pattern unexpectedly matched %q", origin)
		}
	}
}
