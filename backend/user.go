package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"strings"
	"syscall"

	"golang.org/x/term"

	"github.com/bleemeo/dashglass/backend/internal/auth"
)

// runUser is the break-glass CLI for local accounts (DESIGN.md §7.4):
// `dashglass user add|passwd|rm [-auth-file path] <username> [role]`. The
// admin UI is the primary path; this exists for when you are locked out.
func runUser(args []string, stdout, stderr io.Writer) int {
	authFile := "./auth.yaml"
	if env := os.Getenv("DASHGLASS_AUTH_FILE"); env != "" {
		authFile = env
	}
	// Optional leading -auth-file flag.
	for len(args) >= 2 && args[0] == "-auth-file" {
		authFile = args[1]
		args = args[2:]
	}
	if len(args) < 2 {
		fmt.Fprintln(stderr, "usage: dashglass user [-auth-file path] <add|passwd|rm> <username> [role]")
		return 2
	}
	action, username := args[0], args[1]

	store, err := auth.NewStore(authFile)
	if err != nil {
		fmt.Fprintf(stderr, "dashglass user: %v\n", err)
		return 1
	}

	switch action {
	case "add":
		role := auth.RoleAdmin
		if len(args) >= 3 {
			parsed, err := auth.ParseRole(args[2])
			if err != nil {
				fmt.Fprintf(stderr, "dashglass user: %v\n", err)
				return 2
			}
			role = parsed
		}
		password, err := readPassword(stdout, stderr)
		if err != nil {
			fmt.Fprintf(stderr, "dashglass user: %v\n", err)
			return 1
		}
		if err := store.Create(username, password, role); err != nil {
			fmt.Fprintf(stderr, "dashglass user: %v\n", err)
			return 1
		}
		fmt.Fprintf(stdout, "created %s (%s)\n", username, role)
	case "passwd":
		password, err := readPassword(stdout, stderr)
		if err != nil {
			fmt.Fprintf(stderr, "dashglass user: %v\n", err)
			return 1
		}
		if err := store.Update(username, nil, &password); err != nil {
			fmt.Fprintf(stderr, "dashglass user: %v\n", err)
			return 1
		}
		fmt.Fprintf(stdout, "password updated for %s\n", username)
	case "rm":
		if err := store.Delete(username); err != nil {
			fmt.Fprintf(stderr, "dashglass user: %v\n", err)
			return 1
		}
		fmt.Fprintf(stdout, "removed %s\n", username)
	default:
		fmt.Fprintf(stderr, "dashglass user: unknown action %q\n", action)
		return 2
	}
	return 0
}

// readPassword prompts twice on a TTY, or reads one line from stdin when
// piped (scripts, `docker exec … <<<`).
func readPassword(stdout, stderr io.Writer) (string, error) {
	if term.IsTerminal(int(syscall.Stdin)) {
		fmt.Fprint(stderr, "Password: ")
		first, err := term.ReadPassword(int(syscall.Stdin))
		fmt.Fprintln(stderr)
		if err != nil {
			return "", err
		}
		fmt.Fprint(stderr, "Confirm: ")
		second, err := term.ReadPassword(int(syscall.Stdin))
		fmt.Fprintln(stderr)
		if err != nil {
			return "", err
		}
		if string(first) != string(second) {
			return "", fmt.Errorf("passwords do not match")
		}
		return string(first), nil
	}
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}
