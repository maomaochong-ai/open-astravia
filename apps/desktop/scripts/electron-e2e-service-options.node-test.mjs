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

test("packaged E2E retries a failed spec once with a fresh browser instance", () => {
	assert.deepEqual(resolveElectronE2eSpecRetryOptions({ packaged: true }), {
		specFileRetries: 1,
		specFileRetriesDelay: 0,
		specFileRetriesDeferred: false,
	});
	assert.deepEqual(resolveElectronE2eSpecRetryOptions({ packaged: false }), {
		specFileRetries: 0,
		specFileRetriesDelay: 0,
		specFileRetriesDeferred: false,
	});
});
