// Command vetta-ssh-helper runs on a remote project host and answers requests
// from the Vetta desktop app over the SSH channel's stdio.
//
// It runs as the login user, listens on no socket, and needs nothing installed
// on the host: a single static binary uploaded by the desktop app.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"vetta-ssh-helper/internal/protocol"
	"vetta-ssh-helper/internal/server"
)

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--version", "version":
			fmt.Println(protocol.Version)
			return
		case "serve":
		default:
			fmt.Fprintf(os.Stderr, "usage: %s [serve|version]\n", filepath.Base(os.Args[0]))
			os.Exit(2)
		}
	}
	stateDir, err := resolveStateDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, "vetta-ssh-helper:", err)
		os.Exit(1)
	}
	if err := server.New(server.Options{StateDir: stateDir}).Serve(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "vetta-ssh-helper:", err)
		os.Exit(1)
	}
}

// resolveStateDir keeps task records outside the versioned install directory:
// a task started by one helper version must stay visible to the next.
func resolveStateDir() (string, error) {
	if override := os.Getenv("VETTA_HELPER_STATE_DIR"); override != "" {
		return override, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".cache", "vetta", "helper", "state"), nil
}
