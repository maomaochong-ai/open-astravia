import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { presetsDir, resolveSystemPluginSelection } from "./stage-system-plugins.mjs";

// 清单的真源是 packages/plugins/tenants.json。这里不再抄一份：每加一个 preset 都要同步改
// 两处，而这个测试要验的本来就是「按租户与 profile 取到正确的那一份、顺序不乱」，不是清单内容。
const tenants = JSON.parse(
	await readFile(new URL("../../../packages/plugins/tenants.json", import.meta.url), "utf8"),
);
const developmentPluginIds = tenants.profiles.development.common;
const productionPluginIds = tenants.profiles.production.common;

test("common keeps the full plugin set in development", () => {
	const tenant = resolveSystemPluginSelection("common", "development");

	assert.equal(tenant.name, "common");
	assert.equal(tenant.profile, "development");
	assert.deepEqual([...tenant.pluginIds], developmentPluginIds);
});

test("common packages only the production plugin set", () => {
	const tenant = resolveSystemPluginSelection("common", "production");

	assert.equal(tenant.name, "common");
	assert.equal(tenant.profile, "production");
	assert.deepEqual([...tenant.pluginIds], productionPluginIds);
});

// 生产漏项会让用户在打包版里找不到对应入口，而开发环境一切正常，排查成本很高。
// 需要长期的 profile 差异时，先把期望的差异写进这个测试，而不是只在 tenants.json 里删一行。
test("production ships the same built-in plugins as development", () => {
	assert.deepEqual(productionPluginIds, developmentPluginIds);
});

test("rejects an unknown tenant", () => {
	assert.throws(
		() => resolveSystemPluginSelection("nope", "production"),
		/未知租户：nope/,
	);
});

test("rejects an unknown system plugin profile", () => {
	assert.throws(
		() => resolveSystemPluginSelection("common", "preview"),
		/未知系统插件 profile：preview/,
	);
});

test("preset ability descriptors match their plugin manifest identity", async () => {
	const entries = await readdir(presetsDir, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const pluginDir = join(presetsDir, entry.name);
		const abilityPath = join(pluginDir, "ability.json");
		if (!existsSync(abilityPath)) continue;
		const [manifest, ability] = await Promise.all([
			readFile(join(pluginDir, "plugin.json"), "utf8").then(JSON.parse),
			readFile(abilityPath, "utf8").then(JSON.parse),
		]);

		assert.equal(ability.slug, manifest.id, `${entry.name}: ability slug must match plugin id`);
		assert.equal(ability.version, manifest.version, `${entry.name}: ability version must match plugin version`);
	}
});

test("development and packaging scripts pin their system plugin profiles without a recursive lifecycle hook", async () => {
	const packageJson = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	);
	const desktopPackPreparation = packageJson.scripts["prepare:desktop-pack"];

	assert.match(
		packageJson.scripts["build:presets:dev"],
		/ASTRAVIA_SYSTEM_PLUGIN_PROFILE=development/,
	);
	assert.match(packageJson.scripts["build:pack"], /ASTRAVIA_SYSTEM_PLUGIN_PROFILE=production/);
	assert.match(packageJson.scripts["prepare:pack"], /ASTRAVIA_SYSTEM_PLUGIN_PROFILE=production/);
	assert.match(packageJson.scripts.build, /bun run build:presets:prebuilt/);
	assert.match(packageJson.scripts["build:presets:prebuilt"], /ASTRAVIA_SKIP_PLUGIN_TOOLING_BUILD=1/);
	const productionWorkspaceBuild = packageJson.scripts["prepare:workspace"];
	const developmentWorkspaceBuild = packageJson.scripts["prepare:workspace:dev"];
	for (const script of [productionWorkspaceBuild, developmentWorkspaceBuild]) {
		// 开发入口允许先跑一次依赖安装，但构建命令本身必须仍以 turbo run build 开头。
		assert.match(script, /^(?:bun scripts\/ensure-workspace-install\.mjs && )?turbo run build /);
		assert.match(script, /--cwd \.\.\/\.\./);
		assert.match(script, /--filter=@astravia\/desktop\.\.\./);
		assert.match(script, /--filter=@astravia-org\/plugin-vite\.\.\./);
		assert.match(script, /--filter=!@astravia\/desktop/);
		assert.doesNotMatch(script, /--env-mode=loose/);
	}
	assert.match(productionWorkspaceBuild, /--force/);
	assert.doesNotMatch(developmentWorkspaceBuild, /--force/);
	assert.equal(packageJson.scripts["prebuild:pack"], undefined);
	assert.ok(
		desktopPackPreparation.indexOf("bun run prepare:workspace") <
			desktopPackPreparation.indexOf("bun run build:pack"),
		"workspace prerequisites must be built before Desktop bundles and themes",
	);
	assert.match(desktopPackPreparation, /bun run build:pack/);
	assert.match(desktopPackPreparation, /bun run prepare:pack/);
	assert.match(packageJson.scripts["dist:desktop"], /bun run prepare:desktop-pack/);
});
