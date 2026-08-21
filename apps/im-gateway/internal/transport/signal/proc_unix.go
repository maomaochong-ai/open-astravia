//go:build !windows

package signalcli

import (
	"os/exec"
	"syscall"
)

// configureProcessGroup puts the child in its own process group so a
// terminate signal reaches signal-cli's own children too (the JVM launcher
// script spawns java as a grandchild), and so a Ctrl-C delivered to the
// gateway's group does not race our own supervision.
func configureProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// terminateProcessGroup sends SIGTERM to the whole group. Falls back to the
// single process when the group signal fails (the child may have exited, or
// never got its own group).
func terminateProcessGroup(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM); err == nil {
		return nil
	}
	return cmd.Process.Signal(syscall.SIGTERM)
}
