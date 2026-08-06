package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeExecutable(t *testing.T, root string, version string) string {
	t.Helper()
	target := executableForVersion(root, version)
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("exe"), 0o755); err != nil {
		t.Fatal(err)
	}
	return target
}

func TestResolveLaunchTargetUsesActiveLocalVersion(t *testing.T) {
	installRoot := t.TempDir()
	localRoot := t.TempDir()
	writeExecutable(t, installRoot, "1.0.0")
	localTarget := writeExecutable(t, localRoot, "1.1.0")
	writePointer(filepath.Join(installRoot, "current.json"), versionPointer{Version: "1.0.0"})
	writePointer(filepath.Join(localRoot, "current.json"), versionPointer{Version: "1.1.0"})

	if target := resolveLaunchTarget(installRoot, localRoot); target != localTarget {
		t.Fatalf("expected %s, got %s", localTarget, target)
	}
}

func TestResolveLaunchTargetRollsBackPendingVersion(t *testing.T) {
	installRoot := t.TempDir()
	localRoot := t.TempDir()
	writeExecutable(t, installRoot, "1.0.0")
	previousTarget := writeExecutable(t, localRoot, "1.1.0")
	writeExecutable(t, localRoot, "1.2.0")
	writePointer(filepath.Join(installRoot, "current.json"), versionPointer{Version: "1.0.0"})
	writePointer(filepath.Join(localRoot, "current.json"), versionPointer{
		Version:         "1.2.0",
		PreviousVersion: "1.1.0",
		Pending:         true,
	})

	if target := resolveLaunchTarget(installRoot, localRoot); target != previousTarget {
		t.Fatalf("expected %s, got %s", previousTarget, target)
	}
}

func TestResolveLaunchTargetFallsBackToBundledVersion(t *testing.T) {
	installRoot := t.TempDir()
	localRoot := t.TempDir()
	bundledTarget := writeExecutable(t, installRoot, "1.0.0")
	writePointer(filepath.Join(installRoot, "current.json"), versionPointer{Version: "1.0.0"})
	writePointer(filepath.Join(localRoot, "current.json"), versionPointer{
		Version:         "1.1.0",
		PreviousVersion: "1.0.0",
		Pending:         true,
	})

	if target := resolveLaunchTarget(installRoot, localRoot); target != bundledTarget {
		t.Fatalf("expected %s, got %s", bundledTarget, target)
	}
}
