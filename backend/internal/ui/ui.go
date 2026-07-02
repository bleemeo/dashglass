// Package ui embeds the built SPA so the backend ships as a single binary.
// The dist directory currently holds a placeholder; the real build lands
// there once apps/polaris exists (copied by its build step).
package ui

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed dist
var dist embed.FS

// Handler serves the SPA with client-side-routing fallback: unknown paths
// (that are not files) get index.html so react-router owns the URL space.
func Handler() http.Handler {
	root, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err) // embed layout is fixed at compile time
	}
	fileServer := http.FileServerFS(root)
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		path := strings.TrimPrefix(request.URL.Path, "/")
		if path != "" {
			if _, err := fs.Stat(root, path); err == nil {
				fileServer.ServeHTTP(writer, request)
				return
			}
		}
		http.ServeFileFS(writer, request, root, "index.html")
	})
}
