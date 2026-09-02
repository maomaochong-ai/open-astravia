> Every `references/…` path in this file is relative to the skill directory.

# Running and Diagnosing

SKILL.md covers the everyday loop: pick a device, build, look, interact. This file is the layer
you open when that is not enough — the full run cycle, log capture, how to pin down the bundle id
and the build product, and what to check when something goes wrong.

Everything here comes from two commands the plugin already provides — `xcrun` (`simctl` /
`xcodebuild`) and `baguette`. There is no MCP server behind the simulator panel, so do not look for
simulator tools in the tool list. The agent shares the one device the user is watching in the panel.

## The full run cycle

Follow this order unless the user asked for a narrower action.

### 1. Pick the device

```bash
baguette list                          # NDJSON: udid, name, state, runtime
```

Reuse a device whose `state` is already `Booted` — the panel is most likely mirroring it, and
booting another one means the user cannot see what you are doing. Only when nothing is running do
you choose a device to boot, and say which one you booted:

```bash
baguette boot --udid <udid>            # headless; Simulator.app is not required
xcrun simctl bootstatus <udid> -b      # blocks until the device is actually usable
```

Pass `--udid` / `<udid>` explicitly everywhere. `simctl` accepts the literal `booted`, but with
several devices running it silently picks one, which may not be the one in the panel.

### 2. Identify the project entry point and scheme

```bash
xcrun xcodebuild -list -json                          # project/workspace and schemes here
xcrun xcodebuild -workspace <name>.xcworkspace -list -json
```

Use `-workspace` when an `.xcworkspace` exists, otherwise `-project`; a SwiftPM executable package
only needs `-scheme`. Do not infer the scheme from the directory name.

### 3. Build, install, launch

```bash
DEST="platform=iOS Simulator,id=<udid>"
xcrun xcodebuild -scheme <Scheme> -destination "$DEST" build
APP=$(xcrun xcodebuild -scheme <Scheme> -destination "$DEST" -showBuildSettings -json \
  | jq -r '.[0].buildSettings | .BUILT_PRODUCTS_DIR + "/" + .FULL_PRODUCT_NAME')
xcrun simctl install <udid> "$APP"
xcrun simctl launch --console-pty <udid> <bundle-id>
```

Always read the product path from `-showBuildSettings`; never guess the DerivedData layout. When
the bundle id is unknown, read it from the built product rather than hunting through sources:

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist"
```

**Stop here if the build fails.** Read xcodebuild's stderr, fix the error, rebuild. Do not go on to
tap the UI with a stale binary — you would be looking at the previous build. Once the build
succeeds, confirm the app actually came up with `baguette describe-ui` or a screenshot before
interacting.

If the app is already installed and only needs restarting, skip the build and `simctl launch`
directly. If the code changed, you must rebuild and reinstall — `simctl launch` does not compile.

## Logs and console output

```bash
# Follow one app's logs (Ctrl-C to stop)
xcrun simctl spawn <udid> log stream --level debug \
  --predicate 'subsystem == "<your.subsystem>"'

# Look back over the last few minutes — "I just tapped that, what happened?"
xcrun simctl spawn <udid> log show --last 5m --style compact \
  --predicate 'processImagePath ENDSWITH "<AppName>"'
```

`simctl launch --console-pty` wires the app's stdout/stderr straight to the terminal and is the
shortest path to `print` output, but it holds the process; for anything long-running, background it
or use `log stream` instead.

Crash reports land in `~/Library/Logs/DiagnosticReports/`; take the newest one by timestamp.

Quote the **relevant lines** back to the user. Do not paste whole log dumps into the conversation.

## Paths that need no gestures

These are far shorter than locating a control and tapping it. Prefer them when they apply:

```bash
xcrun simctl openurl <udid> "myapp://path"              # jump straight to a screen
xcrun simctl push <udid> <bundle-id> payload.json       # simulate a push
xcrun simctl privacy <udid> grant photos <bundle-id>    # pre-authorize instead of tapping a dialog
xcrun simctl ui <udid> appearance dark                  # light/dark appearance
xcrun simctl status_bar <udid> override --time "9:41" --batteryLevel 100
xcrun simctl terminate <udid> <bundle-id>               # clean restart of the app
```

Whether a deep link works depends on the URL scheme the project registers — see
`references/deeplinks.md`.

## Symptom table

| Symptom | Check first |
| --- | --- |
| Build fails | The first `error:` in xcodebuild's stderr; whether scheme and destination are right. Do not simply re-run the same command |
| Installs but exits immediately | The `--console-pty` output, plus crash lines in `log show --last 2m` |
| Old behavior after a code change | Did you only `launch` without `build` + `install`? `simctl uninstall` and reinstall if state is suspect |
| Wrong app launches | Whether the bundle id matches the scheme; re-read it from the product with `PlistBuddy` |
| Taps do nothing | Whether `baguette` meets the plugin's minimum version (iOS 26 changed the gesture-injection calling convention); whether coordinates came from screenshot pixels instead of accessibility-tree points |
| Control missing from `describe-ui` | Layout or navigation just changed — re-run `describe-ui`; the element may be off-screen, so scroll first |
| Panel is black / no picture | Whether the device is really `Booted` (`simctl bootstatus`); restart the simulator service from the plugin's settings page |

## Hand back to the user

- Anything needing a real device, a signing identity, or App Store Connect.
- Performance problems that need an Instruments trace: give the collection steps and ask for the
  result — see `references/guide-performance-audit.md` and `references/profiling-intake.md`.
- Erasing a device, deleting app data, or signing into a real account. Ask first; see the
  Boundaries section in SKILL.md.
