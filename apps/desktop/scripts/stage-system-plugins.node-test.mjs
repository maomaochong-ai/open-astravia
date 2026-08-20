import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveSystemPluginSelection } from "./stage-system-plugins.mjs";

const developmentPluginIds = [
	"vetta-actions",
	"vetta-ui-design",
	"image-gen",
	"media-viewer",
	"office-viewer",
	"svg-viewer",
	"chart-renderer",
	"git",
	"plugin-workbench",
	"comfyui-media-provider",
	"content-creation",
	"kanban",
];

const productionPluginIds = [
	"vetta-actions",
	"vetta-ui-design",
	"image-gen",
	"media-viewer",
	"office-viewer",
	"svg-viewer",
	"chart-renderer",
	"git",
	"plugin-workbench",
];


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

test("development and packaging scripts pin their system plugin profiles without a recursive lifecycle hook", async () => {
	const packageJson = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	);
	const desktopPackPreparation = packageJson.scripts["prepare:desktop-pack"];

	assert.match(
		packageJson.scripts["build:presets:dev"],
		/VETTA_SYSTEM_PLUGIN_PROFILE=development/,
	);
	assert.match(packageJson.scripts["build:pack"], /VETTA_SYSTEM_PLUGIN_PROFILE=production/);
	assert.match(packageJson.scripts["prepare:pack"], /VETTA_SYSTEM_PLUGIN_PROFILE=production/);
	assert.equal(packageJson.scripts["prebuild:pack"], undefined);
	assert.match(desktopPackPreparation, /bun run build:pack/);
	assert.match(desktopPackPreparation, /bun run prepare:pack/);
	assert.match(packageJson.scripts["dist:desktop"], /bun run prepare:desktop-pack/);
});
