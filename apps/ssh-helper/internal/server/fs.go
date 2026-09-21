package server

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"vetta-ssh-helper/internal/protocol"
)

// Entry describes one filesystem object. Kind never follows symlinks unless the
// caller asked for it, so a file tree can show a link as a link.
type Entry struct {
	Name       string `json:"name"`
	Kind       string `json:"kind"` // file | directory | symlink | other
	Size       int64  `json:"size"`
	ModifiedMs int64  `json:"modifiedMs"`
	Mode       uint32 `json:"mode"`
}

func kindOf(mode fs.FileMode) string {
	switch {
	case mode&fs.ModeSymlink != 0:
		return "symlink"
	case mode.IsDir():
		return "directory"
	case mode.IsRegular():
		return "file"
	default:
		return "other"
	}
}

func entryFrom(name string, info fs.FileInfo) Entry {
	return Entry{
		Name:       name,
		Kind:       kindOf(info.Mode()),
		Size:       info.Size(),
		ModifiedMs: info.ModTime().UnixMilli(),
		Mode:       uint32(info.Mode().Perm()),
	}
}

func mapFsError(err error) *protocol.Error {
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return protocol.Errorf(protocol.CodeNotFound, err.Error())
	case errors.Is(err, fs.ErrExist):
		return protocol.Errorf(protocol.CodeExists, err.Error())
	default:
		return protocol.Errorf(protocol.CodeInternal, err.Error())
	}
}

func requireAbsolute(path string) *protocol.Error {
	if !filepath.IsAbs(path) {
		return protocol.Errorf(protocol.CodeInvalid, "path must be absolute: "+path)
	}
	return nil
}

type statParams struct {
	Path           string `json:"path"`
	FollowSymlinks bool   `json:"followSymlinks"`
}

// statResult.Entry is nil when the path does not exist: that is an answer, not a
// failure, and callers rely on telling the two apart.
type statResult struct {
	Entry *Entry `json:"entry"`
}

func fsStat(p statParams) (any, *protocol.Error) {
	if e := requireAbsolute(p.Path); e != nil {
		return nil, e
	}
	stat := os.Lstat
	if p.FollowSymlinks {
		stat = os.Stat
	}
	info, err := stat(p.Path)
	if errors.Is(err, fs.ErrNotExist) {
		return statResult{}, nil
	}
	if err != nil {
		return nil, mapFsError(err)
	}
	entry := entryFrom(filepath.Base(p.Path), info)
	return statResult{Entry: &entry}, nil
}

type pathParams struct {
	Path string `json:"path"`
}

func fsReadDir(p pathParams) (any, *protocol.Error) {
	if e := requireAbsolute(p.Path); e != nil {
		return nil, e
	}
	items, err := os.ReadDir(p.Path)
	if err != nil {
		return nil, mapFsError(err)
	}
	entries := make([]Entry, 0, len(items))
	for _, item := range items {
		info, err := item.Info()
		if err != nil {
			continue // Raced with a delete; the entry is simply gone.
		}
		entries = append(entries, entryFrom(item.Name(), info))
	}
	return map[string]any{"entries": entries}, nil
}

type readFileParams struct {
	Path   string `json:"path"`
	Offset int64  `json:"offset"`
	// Length < 0 reads to the end.
	Length int64 `json:"length"`
}

type readFileResult struct {
	Data string `json:"data"` // base64
	Size int64  `json:"size"`
	// Revision is the SHA-256 of the WHOLE file, present only for whole-file
	// reads. Pass it back to fs.writeFile to make an edit a single round trip
	// that still refuses to clobber a concurrent change.
	Revision string `json:"revision,omitempty"`
}

func fsReadFile(p readFileParams) (any, *protocol.Error) {
	if e := requireAbsolute(p.Path); e != nil {
		return nil, e
	}
	file, err := os.Open(p.Path)
	if err != nil {
		return nil, mapFsError(err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, mapFsError(err)
	}
	if info.IsDir() {
		return nil, protocol.Errorf(protocol.CodeInvalid, "is a directory: "+p.Path)
	}
	whole := p.Offset == 0 && p.Length < 0
	if p.Offset > 0 {
		if _, err := file.Seek(p.Offset, io.SeekStart); err != nil {
			return nil, mapFsError(err)
		}
	}
	var reader io.Reader = file
	if p.Length >= 0 {
		reader = io.LimitReader(file, p.Length)
	}
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, mapFsError(err)
	}
	result := readFileResult{Data: base64.StdEncoding.EncodeToString(data), Size: info.Size()}
	if whole {
		result.Revision = revisionOf(data)
	}
	return result, nil
}

func revisionOf(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

type writeFileParams struct {
	Path string `json:"path"`
	Data string `json:"data"` // base64
	// ExpectedRevision, when set, makes the write conditional on the file still
	// having that content. "" means unconditional.
	ExpectedRevision string `json:"expectedRevision"`
	CreateParents    bool   `json:"createParents"`
}

// fsWriteFile replaces a file atomically while keeping what makes it that file:
// its permission bits and, when the path is a symlink, the link itself.
//
// Writing a fresh temp file and renaming it over the target would silently drop
// the executable bit from a script and turn a symlink into a regular file, so
// the temp file inherits the target's mode and the rename targets the resolved
// path.
func fsWriteFile(p writeFileParams) (any, *protocol.Error) {
	if e := requireAbsolute(p.Path); e != nil {
		return nil, e
	}
	data, err := base64.StdEncoding.DecodeString(p.Data)
	if err != nil {
		return nil, protocol.Errorf(protocol.CodeInvalid, "data is not valid base64")
	}
	target := p.Path
	if resolved, err := filepath.EvalSymlinks(p.Path); err == nil {
		target = resolved
	}
	mode := fs.FileMode(0o644)
	existing, statErr := os.Stat(target)
	if statErr == nil {
		if existing.IsDir() {
			return nil, protocol.Errorf(protocol.CodeInvalid, "is a directory: "+p.Path)
		}
		mode = existing.Mode().Perm()
	}
	if p.ExpectedRevision != "" {
		current, err := os.ReadFile(target)
		if err != nil {
			return nil, mapFsError(err)
		}
		if actual := revisionOf(current); actual != p.ExpectedRevision {
			return nil, protocol.Errorf(protocol.CodeConflict, "file changed since it was read; current revision "+actual)
		}
	}
	if p.CreateParents {
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return nil, mapFsError(err)
		}
	}
	// Same directory, so the rename stays on one filesystem and is atomic.
	temp, err := os.CreateTemp(filepath.Dir(target), "."+filepath.Base(target)+".vetta-tmp-*")
	if err != nil {
		return nil, mapFsError(err)
	}
	tempPath := temp.Name()
	cleanup := func() { _ = os.Remove(tempPath) }
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		cleanup()
		return nil, mapFsError(err)
	}
	if err := temp.Close(); err != nil {
		cleanup()
		return nil, mapFsError(err)
	}
	if err := os.Chmod(tempPath, mode); err != nil {
		cleanup()
		return nil, mapFsError(err)
	}
	if err := os.Rename(tempPath, target); err != nil {
		cleanup()
		return nil, mapFsError(err)
	}
	return map[string]any{"revision": revisionOf(data), "size": len(data)}, nil
}

func fsMkdir(p pathParams) (any, *protocol.Error) {
	if e := requireAbsolute(p.Path); e != nil {
		return nil, e
	}
	if err := os.MkdirAll(p.Path, 0o755); err != nil {
		return nil, mapFsError(err)
	}
	return map[string]any{}, nil
}

type renameParams struct {
	From string `json:"from"`
	To   string `json:"to"`
}

func fsRename(p renameParams) (any, *protocol.Error) {
	if e := requireAbsolute(p.From); e != nil {
		return nil, e
	}
	if e := requireAbsolute(p.To); e != nil {
		return nil, e
	}
	if err := os.Rename(p.From, p.To); err != nil {
		return nil, mapFsError(err)
	}
	return map[string]any{}, nil
}

func fsRemove(p pathParams) (any, *protocol.Error) {
	if e := requireAbsolute(p.Path); e != nil {
		return nil, e
	}
	if filepath.Clean(p.Path) == string(filepath.Separator) {
		return nil, protocol.Errorf(protocol.CodeInvalid, "refusing to remove the root directory")
	}
	if err := os.RemoveAll(p.Path); err != nil {
		return nil, mapFsError(err)
	}
	return map[string]any{}, nil
}

type createEntryParams struct {
	Path string `json:"path"`
	Kind string `json:"kind"` // file | directory
}

// fsCreateEntry never overwrites: O_EXCL / Mkdir fail when something is already
// there, which closes the check-then-create race a shell version would have.
func fsCreateEntry(p createEntryParams) (any, *protocol.Error) {
	if e := requireAbsolute(p.Path); e != nil {
		return nil, e
	}
	switch p.Kind {
	case "directory":
		if err := os.Mkdir(p.Path, 0o755); err != nil {
			return nil, mapFsError(err)
		}
	case "file":
		file, err := os.OpenFile(p.Path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err != nil {
			return nil, mapFsError(err)
		}
		file.Close()
	default:
		return nil, protocol.Errorf(protocol.CodeInvalid, "kind must be file or directory")
	}
	info, err := os.Lstat(p.Path)
	if err != nil {
		return nil, mapFsError(err)
	}
	return map[string]any{"entry": entryFrom(filepath.Base(p.Path), info)}, nil
}

func fsRealPath(p pathParams) (any, *protocol.Error) {
	if e := requireAbsolute(p.Path); e != nil {
		return nil, e
	}
	resolved, err := filepath.EvalSymlinks(p.Path)
	if err != nil {
		return nil, mapFsError(err)
	}
	return map[string]any{"path": resolved}, nil
}

type listRecursiveParams struct {
	Path                 string   `json:"path"`
	IgnoredDirectories   []string `json:"ignoredDirectories"`
	Limit                int      `json:"limit"`
	IncludeHiddenEntries bool     `json:"includeHiddenEntries"`
}

// fsListRecursive walks the tree on the machine that owns it. Doing this from
// the client costs one round trip per directory; here it is one call.
func fsListRecursive(p listRecursiveParams) (any, *protocol.Error) {
	if e := requireAbsolute(p.Path); e != nil {
		return nil, e
	}
	limit := p.Limit
	if limit <= 0 {
		limit = 10000
	}
	ignored := make(map[string]struct{}, len(p.IgnoredDirectories))
	for _, name := range p.IgnoredDirectories {
		ignored[name] = struct{}{}
	}
	files := make([]string, 0, 256)
	truncated := false
	err := filepath.WalkDir(p.Path, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			if path == p.Path {
				return err
			}
			return nil // Unreadable subtree: skip it, keep the rest.
		}
		if path == p.Path {
			return nil
		}
		name := entry.Name()
		hidden := !p.IncludeHiddenEntries && strings.HasPrefix(name, ".")
		if entry.IsDir() {
			if _, skip := ignored[name]; skip || hidden {
				return filepath.SkipDir
			}
			return nil
		}
		if hidden || !entry.Type().IsRegular() {
			return nil
		}
		if len(files) >= limit {
			truncated = true
			return filepath.SkipAll
		}
		relative, err := filepath.Rel(p.Path, path)
		if err != nil {
			return nil
		}
		files = append(files, filepath.ToSlash(relative))
		return nil
	})
	if err != nil {
		return nil, mapFsError(err)
	}
	sort.Strings(files)
	return map[string]any{"files": files, "truncated": truncated}, nil
}
