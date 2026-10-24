import assert from "node:assert/strict";
import test from "node:test";
import { resolveDevLaunchEnvironment } from "./run-dev-electron.mjs";

const home = "/Users/tester";

test("pins the dev data home under the dev config dir even when the host exports ASTRAVIA_HOME", () => {
	// 宿主导出的 ASTRAVIA_HOME 优先级高于 ASTRAVIA_CONFIG_DIR：透进来就会和宿主共用 sessions。
	const env = resolveDevLaunchEnvironment({ ASTRAVIA_HOME: "/Users/tester/.astravia" }, home);

	assert.equal(env.configDir, ".astravia-dev");
	assert.equal(env.homePath, "/Users/tester/.astravia-dev");
	assert.equal(env.userDataDir, "/Users/tester/.astravia-dev/electron-user-data");
});

test("keeps the data home aligned when ASTRAVIA_CONFIG_DIR is overridden", () => {
	const env = resolveDevLaunchEnvironment(
		{ ASTRAVIA_HOME: "/Users/tester/.astravia", ASTRAVIA_CONFIG_DIR: ".astravia-smoke" },
		home,
	);

	assert.equal(env.configDir, ".astravia-smoke");
	assert.equal(env.homePath, "/Users/tester/.astravia-smoke");
});

test("pins the data home to the verification config dir during ui verification", () => {
	const env = resolveDevLaunchEnvironment({ ASTRAVIA_UI_VERIFICATION: "1", ASTRAVIA_HOME: "/Users/tester/.astravia" }, home);

	assert.equal(env.configDir, ".astravia-ui-verify");
	assert.equal(env.homePath, "/Users/tester/.astravia-ui-verify");
});

test("honours an explicit ASTRAVIA_DEV_HOME escape hatch", () => {
	const env = resolveDevLaunchEnvironment(
		{ ASTRAVIA_HOME: "/Users/tester/.astravia", ASTRAVIA_DEV_HOME: "/Volumes/scratch/dev-home" },
		home,
	);

	assert.equal(env.homePath, "/Volumes/scratch/dev-home");
	assert.equal(env.configDir, ".astravia-dev");
});

test("resolves an explicit desktop user data dir independently of the data home", () => {
	const env = resolveDevLaunchEnvironment(
		{ ASTRAVIA_DESKTOP_USER_DATA_DIR: "/Volumes/scratch/user-data" },
		home,
	);

	assert.equal(env.userDataDir, "/Volumes/scratch/user-data");
	assert.equal(env.homePath, "/Users/tester/.astravia-dev");
});

test("treats an inherited absolute ASTRAVIA_CONFIG_DIR as the config root, not a child of home", () => {
	// 已安装的桌面应用导出的就是绝对路径；直接 join 会拼出 ~/Users/<name>/... 这种重复前缀。
	const env = resolveDevLaunchEnvironment(
		{ ASTRAVIA_HOME: "/Users/tester/.astravia", ASTRAVIA_CONFIG_DIR: "/Users/tester/.astravia-dev" },
		home,
	);

	assert.equal(env.homePath, "/Users/tester/.astravia-dev");
	assert.equal(env.userDataDir, "/Users/tester/.astravia-dev/electron-user-data");
});

test("expands a tilde-prefixed dev home against the passed home directory", () => {
	const env = resolveDevLaunchEnvironment({ ASTRAVIA_DEV_HOME: "~/scratch/dev-home" }, home);

	assert.equal(env.homePath, "/Users/tester/scratch/dev-home");
});
