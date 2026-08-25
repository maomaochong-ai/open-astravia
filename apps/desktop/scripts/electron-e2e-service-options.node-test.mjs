import assert from "node:assert/strict";
import test from "node:test";
import {
	resolveElectronE2eServiceOptions,
	resolveElectronE2eSpecRetryOptions,
} from "./electron-e2e-service-options.mjs";

test("Linux CI installs a scoped AppArmor profile before launching Electron", () => {
	assert.deepEqual(resolveElectronE2eServiceOptions({ platform: "linux", ci: "true" }), {
		clearMocks: true,
		apparmorAutoInstall: "sudo",
	});
});

test("local and non-Linux E2E runs do not request elevated AppArmor setup", () => {
	assert.deepEqual(resolveElectronE2eServiceOptions({ platform: "linux", ci: "false" }), {
		clearMocks: true,
	});
	assert.deepEqual(resolveElectronE2eServiceOptions({ platform: "win32", ci: "true" }), {
		clearMocks: true,
	});
});

test("only Linux packaged E2E retries a failed spec with a fresh browser instance", () => {
	assert.deepEqual(resolveElectronE2eSpecRetryOptions({ platform: "linux", packaged: true }), {
		specFileRetries: 1,
		specFileRetriesDelay: 0,
		specFileRetriesDeferred: false,
	});
	for (const input of [
		{ platform: "linux", packaged: false },
		{ platform: "win32", packaged: true },
		{ platform: "darwin", packaged: true },
	]) {
		assert.deepEqual(resolveElectronE2eSpecRetryOptions(input), {
			specFileRetries: 0,
			specFileRetriesDelay: 0,
			specFileRetriesDeferred: false,
		});
	}
});
