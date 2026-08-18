//go:build windows

package local

import "os/exec"

// prepareSysProcAttr is a no-op on Windows. The first-milestone scope
// excludes Windows; this stub exists only so the package compiles on the
// platform.
func prepareSysProcAttr(_ *exec.Cmd) {}
