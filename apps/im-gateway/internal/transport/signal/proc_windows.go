package signalcli

import "os/exec"

// configureProcessGroup is a no-op on Windows: signal-cli ships as a .bat
// launcher and job-object bookkeeping buys nothing here — Kill on the
// launcher plus the daemon's own shutdown is what we rely on.
func configureProcessGroup(_ *exec.Cmd) {}

// terminateProcessGroup kills the child. Windows has no SIGTERM equivalent
// we can deliver to a console-less child, so this is an immediate kill.
func terminateProcessGroup(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}
