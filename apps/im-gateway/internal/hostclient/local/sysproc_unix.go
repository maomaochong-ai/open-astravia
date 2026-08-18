//go:build !windows

package local

import (
	"os/exec"
	"syscall"
)

// prepareSysProcAttr puts the subprocess into its own process group on
// POSIX systems. This means a SIGINT delivered to the gateway by the user
// (Ctrl-C in a terminal) is NOT automatically forwarded to the agent
// subprocess; the gateway is the only thing that decides when to bring
// the subprocess down (via Close()).
func prepareSysProcAttr(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}
