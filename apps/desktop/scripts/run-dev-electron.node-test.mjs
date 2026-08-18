import assert from "node:assert/strict";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import {
	resolveDevLaunchEnvironment,
	resolveDevPluginIds,
	waitForRendererPort,
} from "./run-dev-electron.mjs";

test("returns when the renderer port becomes reachable", async (context) => {
	const server = createServer();
	context.after(() => server.close());
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	assert.notEqual(address, null);
	assert.equal(typeof address, "object");

	await waitForRendererPort(address.port, { timeoutMs: 500, retryIntervalMs: 10 });
});

test("fails instead of hanging when the renderer port stays unavailable", async () => {
	const server = createServer();
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	assert.notEqual(address, null);
	assert.equal(typeof address, "object");
	const port = address.port;
	await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

	await assert.rejects(
		waitForRendererPort(port, { timeoutMs: 50, retryIntervalMs: 5 }),
		/Timed out after 50ms/,
	);
});

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
	const resolveSelection = (tenant, profile) => {
		assert.equal(tenant, "tenantb");
		assert.equal(profile, "development");
		return { name: tenant, pluginIds: new Set(["svg-viewer", "content-creation", "git"]) };
	};

	assert.equal(
		resolveDevPluginIds({ VETTA_TENANT: "tenantb" }, resolveSelection),
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
