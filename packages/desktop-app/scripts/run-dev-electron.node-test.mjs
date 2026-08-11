import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { resolveDevLaunchEnvironment, resolveDevPluginIds } from "./run-dev-electron.mjs";

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

test("enables every preset from the active tenant by default", () => {
	const resolveTenant = (tenant) => {
		assert.equal(tenant, "tenantb");
		return { name: tenant, pluginIds: new Set(["svg-viewer", "content-creation", "git"]) };
	};

	assert.equal(
		resolveDevPluginIds({ VETTA_TENANT: "tenantb" }, resolveTenant),
		"content-creation,git,svg-viewer",
	);
});

test("preserves an explicit plugin selection or empty opt-out", () => {
	const unexpectedTenantResolution = () => {
		throw new Error("tenant resolution should not run for an explicit selection");
	};

	assert.equal(
		resolveDevPluginIds({ VETTA_PLUGIN_DEV: "git,content-creation" }, unexpectedTenantResolution),
		"git,content-creation",
	);
	assert.equal(resolveDevPluginIds({ VETTA_PLUGIN_DEV: "" }, unexpectedTenantResolution), "");
});
