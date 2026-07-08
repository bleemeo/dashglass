// Package watch turns file-system changes in the dashboards directory into
// events pushed to UI clients: `git pull` in the directory updates open
// dashboards live. That is the GitOps loop.
package watch

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/bleemeo/dashglass/backend/internal/store"
)

// Event notifies that a dashboard file changed. Type is "updated" (created
// or modified — clients treat it as an upsert) or "deleted".
type Event struct {
	Type   string       `json:"type"`
	Name   string       `json:"name"`
	Format store.Format `json:"format,omitempty"`
}

// Hub fans events out to subscribers (SSE connections).
type Hub struct {
	mu   sync.Mutex
	subs map[chan Event]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: map[chan Event]struct{}{}}
}

// Subscribe registers a subscriber; call the returned function to leave.
func (h *Hub) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 16)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subs, ch)
		h.mu.Unlock()
	}
}

// Publish sends an event to every subscriber, dropping it for slow ones
// (SSE clients re-list on reconnect, no delivery guarantee needed).
func (h *Hub) Publish(event Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- event:
		default:
		}
	}
}

// debounceDelay coalesces the bursts of fsnotify events an editor save or
// git checkout produces for a single file.
const debounceDelay = 150 * time.Millisecond

// Watch publishes dashboard file changes to the hub until ctx is done.
func Watch(ctx context.Context, dir string, hub *Hub, logger *slog.Logger) error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	if err := watcher.Add(dir); err != nil {
		watcher.Close()
		return err
	}
	// Folders are one level deep: watch existing subdirectories too.
	if entries, err := os.ReadDir(dir); err == nil {
		for _, entry := range entries {
			if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
				if err := watcher.Add(filepath.Join(dir, entry.Name())); err != nil {
					logger.Warn("watching dashboards subdirectory", "error", err)
				}
			}
		}
	}

	go func() {
		defer watcher.Close()
		var mu sync.Mutex
		pending := map[string]*time.Timer{}

		fire := func(path string) {
			mu.Lock()
			delete(pending, path)
			mu.Unlock()

			format, ok := store.FormatForPath(path)
			if !ok {
				return
			}
			base := filepath.Base(path)
			if strings.HasPrefix(base, ".") {
				return
			}
			// Event names carry the folder, like the store ("folder/name").
			name := base
			if rel, err := filepath.Rel(dir, path); err == nil {
				name = filepath.ToSlash(rel)
			}
			name = strings.TrimSuffix(name, filepath.Ext(name))
			event := Event{Type: "updated", Name: name, Format: format}
			if _, err := os.Stat(path); err != nil {
				event = Event{Type: "deleted", Name: name}
			}
			hub.Publish(event)
		}

		for {
			select {
			case <-ctx.Done():
				mu.Lock()
				for _, timer := range pending {
					timer.Stop()
				}
				mu.Unlock()
				return
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if event.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Remove|fsnotify.Rename) == 0 {
					continue
				}
				path := event.Name
				// A new folder must be watched for the files that follow.
				if event.Op&fsnotify.Create != 0 {
					if info, err := os.Stat(path); err == nil && info.IsDir() {
						if !strings.HasPrefix(filepath.Base(path), ".") {
							if err := watcher.Add(path); err != nil {
								logger.Warn("watching new dashboards subdirectory", "error", err)
							}
						}
						continue
					}
				}
				mu.Lock()
				if timer, ok := pending[path]; ok {
					timer.Reset(debounceDelay)
				} else {
					pending[path] = time.AfterFunc(debounceDelay, func() { fire(path) })
				}
				mu.Unlock()
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				logger.Warn("dashboards watcher error", "error", err)
			}
		}
	}()

	return nil
}
