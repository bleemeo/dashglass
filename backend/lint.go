package main

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"

	"github.com/bleemeo/dashglass/backend/internal/store"
)

// runLint validates dashboard files for CI pipelines: exit code 0 when
// every file is valid, 1 otherwise (2 on usage errors). Arguments are
// files or directories (walked recursively); default: ./dashboards.
func runLint(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		args = []string{"./dashboards"}
	}

	validator, err := store.NewValidator()
	if err != nil {
		fmt.Fprintf(stderr, "dashglass lint: %v\n", err)
		return 2
	}

	var paths []string
	for _, arg := range args {
		info, err := os.Stat(arg)
		if err != nil {
			fmt.Fprintf(stderr, "dashglass lint: %v\n", err)
			return 2
		}
		if !info.IsDir() {
			paths = append(paths, arg)
			continue
		}
		err = filepath.WalkDir(arg, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.Type().IsRegular() {
				if _, ok := store.FormatForPath(path); ok {
					paths = append(paths, path)
				}
			}
			return nil
		})
		if err != nil {
			fmt.Fprintf(stderr, "dashglass lint: %v\n", err)
			return 2
		}
	}
	sort.Strings(paths)
	if len(paths) == 0 {
		fmt.Fprintln(stderr, "dashglass lint: no dashboard files found")
		return 2
	}

	failures := 0
	for _, path := range paths {
		format, ok := store.FormatForPath(path)
		if !ok {
			fmt.Fprintf(stderr, "%s: unsupported extension (json, yaml or toml)\n", path)
			failures++
			continue
		}
		content, err := os.ReadFile(path)
		if err != nil {
			fmt.Fprintf(stderr, "%s: %v\n", path, err)
			failures++
			continue
		}
		if err := validator.Validate(content, format); err != nil {
			failures++
			if validationErr, ok := err.(*store.ValidationError); ok {
				fmt.Fprintf(stdout, "✗ %s\n", path)
				for _, issue := range validationErr.Issues {
					fmt.Fprintf(stdout, "    %s\n", issue)
				}
			} else {
				fmt.Fprintf(stdout, "✗ %s: %v\n", path, err)
			}
			continue
		}
		fmt.Fprintf(stdout, "✓ %s\n", path)
	}

	fmt.Fprintf(stdout, "%d file(s) checked, %d invalid\n", len(paths), failures)
	if failures > 0 {
		return 1
	}
	return 0
}
