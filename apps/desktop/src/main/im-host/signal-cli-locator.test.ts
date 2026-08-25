import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectSignalCli, signalCliInstallHint } from "./signal-cli-locator.js";

/**
 * Detection decides whether the Signal card offers a QR scan or an install
 * command, so the interesting cases are all about what counts as "found".
 */

const originalPath = process.env.PATH;

function makeExecutable(dir: string, name = "signal-cli"): string {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, name);
	writeFileSync(path, "#!/bin/sh\nexit 0\n");
	chmodSync(path, 0o755);
	return path;
}

afterEach(() => {
	process.env.PATH = originalPath;
});

describe("detectSignalCli", () => {
	it("uses an explicit path when it is executable", () => {
		const bin = makeExecutable(mkdtempSync(join(tmpdir(), "signal-cli-")));

		const result = detectSignalCli(bin);

		expect(result.path).toBe(bin);
		expect(result.source).toBe("explicit");
	});

	it("reports not-found for an explicit path that does not resolve", () => {
		// A wrong override must be visible rather than silently falling back
		// to whatever happens to be on PATH.
		const dir = mkdtempSync(join(tmpdir(), "signal-cli-"));
		makeExecutable(dir);
		process.env.PATH = dir;

		const result = detectSignalCli(join(dir, "not-here"));

		expect(result.path).toBeUndefined();
		expect(result.installHint).toBe(signalCliInstallHint());
	});

	it("finds signal-cli on PATH", () => {
		const dir = mkdtempSync(join(tmpdir(), "signal-cli-"));
		const bin = makeExecutable(dir);
		process.env.PATH = [mkdtempSync(join(tmpdir(), "empty-")), dir].join(delimiter);

		const result = detectSignalCli();

		expect(result.path).toBe(bin);
		expect(result.source).toBe("path");
	});

	it("applies the platform executable-file semantics", () => {
		const dir = mkdtempSync(join(tmpdir(), "signal-cli-"));
		const path = join(dir, "signal-cli");
		writeFileSync(path, "not executable");
		chmodSync(path, 0o644);
		process.env.PATH = dir;

		const result = detectSignalCli();

		if (process.platform === "win32") {
			// Windows has no POSIX executable bit; a regular file with a recognized command name is executable.
			expect(result.path).toBe(path);
		} else {
			expect(result.path).not.toBe(path);
		}
	});

	it("always carries an install hint", () => {
		expect(detectSignalCli().installHint).toBe(signalCliInstallHint());
		expect(signalCliInstallHint().length).toBeGreaterThan(0);
	});
});
