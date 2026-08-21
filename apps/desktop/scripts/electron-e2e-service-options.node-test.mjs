import assert from "node:assert/strict";
import test from "node:test";
import { resolveElectronE2eServiceOptions } from "./electron-e2e-service-options.mjs";

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
