import { delimiter } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createNodeShellEnvironment,
	getNodeShellCommandPrefix,
	resolveNodeShell,
	WINDOWS_POWERSHELL_UTF8_COMMAND_PREFIX,
} from "../../src/coding/index.js";

describe("Node shell runtime", () => {
	it("validates and selects a custom shell", () => {
		expect(resolveNodeShell({ customShellPath: "C:/tools/bash.exe", fileExists: () => true })).toEqual({
			executable: "C:/tools/bash.exe",
			args: ["-c"],
		});
		expect(() =>
			resolveNodeShell({
				customShellPath: "C:/missing/bash.exe",
				settingsPath: "C:/vetta/settings.json",
				fileExists: () => false,
			}),
		).toThrow("Please update shellPath in C:/vetta/settings.json");
	});

	it("uses the stable Windows shell preference and fallback", () => {
		const found = new Map([["powershell.exe", "C:/Windows/powershell.exe"]]);
		expect(
			resolveNodeShell({
				platform: "win32",
				fileExists: () => false,
				findExecutable: (name) => found.get(name),
			}),
		).toEqual({
			executable: "C:/Windows/powershell.exe",
			args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"],
		});
		expect(resolveNodeShell({ platform: "win32", fileExists: () => false, findExecutable: () => undefined })).toEqual(
			{ executable: "cmd.exe", args: ["/d", "/s", "/c"] },
		);
	});

	it("adds the PowerShell UTF-8 prefix only on Windows", () => {
		expect(getNodeShellCommandPrefix("C:/tools/pwsh.exe", "win32")).toBe(WINDOWS_POWERSHELL_UTF8_COMMAND_PREFIX);
		expect(getNodeShellCommandPrefix("/usr/bin/pwsh", "linux")).toBeUndefined();
	});

	it("prepends the managed bin directory exactly once", () => {
		const binDirectory = "C:/vetta/bin";
		const initialPath = ["C:/Windows", "C:/tools"].join(delimiter);
		const first = createNodeShellEnvironment(binDirectory, { Path: initialPath, KEEP: "value" });
		const second = createNodeShellEnvironment(binDirectory, first);
		expect(first.Path).toBe([binDirectory, initialPath].join(delimiter));
		expect(second.Path).toBe(first.Path);
		expect(second.KEEP).toBe("value");
	});
});
