// Package ui embeds the built SPA so the backend ships as a single binary.
// The dist directory currently holds a placeholder; the real build lands
// there once apps/dashglass exists (copied by its build step).
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
				// Vite content-hashes everything under assets/, so those
				// files can be cached forever; anything else (favicons…)
				// must be revalidated, like index.html below, so browsers
				// never keep serving a previous binary's UI.
				if strings.HasPrefix(path, "assets/") {
					writer.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				} else {
					writer.Header().Set("Cache-Control", "no-cache")
				}
				fileServer.ServeHTTP(writer, request)
				return
			}
		}
		writer.Header().Set("Cache-Control", "no-cache")
		http.ServeFileFS(writer, request, root, "index.html")
	})
}
