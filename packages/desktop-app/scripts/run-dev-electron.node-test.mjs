import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { resolveDevLaunchEnvironment } from "./run-dev-electron.mjs";

test("isolates normal development from packaged application data", () => {
	const homeDirectory = join("test", "home");

	assert.deepEqual(resolveDevLaunchEnvironment({}, homeDirectory), {
		configDir: ".vetta-dev",
		userDataDir: join(homeDirectory, ".vetta-dev", "electron-user-data"),
	});
});

test("keeps UI verification isolated when no explicit directories are provided", () => {
	const homeDirectory = join("test", "home");

	assert.deepEqual(resolveDevLaunchEnvironment({ VETTA_UI_VERIFICATION: "1" }, homeDirectory), {
		configDir: ".vetta-ui-verify",
		userDataDir: join(homeDirectory, ".vetta-ui-verify", "electron-user-data"),
	});
});

test("preserves explicit config and user data overrides", () => {
	const homeDirectory = join("test", "home");
	const userDataDir = join(process.cwd(), "custom-electron-user-data");

	assert.deepEqual(
		resolveDevLaunchEnvironment(
			{
				VETTA_CONFIG_DIR: ".custom-vetta",
				VETTA_DESKTOP_USER_DATA_DIR: userDataDir,
				VETTA_UI_VERIFICATION: "1",
			},
			homeDirectory,
		),
		{ configDir: ".custom-vetta", userDataDir },
	);
});
