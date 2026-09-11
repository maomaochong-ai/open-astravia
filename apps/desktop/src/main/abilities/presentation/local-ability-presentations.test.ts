import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "../../../preload/api-types/plugins";
import type { BuiltinSkillRegistration } from "../../builtin-skills";
import type { LocalAbilityPresentationDependencies } from "./local-ability-presentations";
import { listLocalAbilityPresentations } from "./local-ability-presentations";

vi.mock("../../logger.js", () => ({
	getAppLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../builtin-skills.js", () => ({
	getBuiltinSkillsDir: () => undefined,
	readBuiltinSkillsManifest: () => ({}),
}));
vi.mock("../../plugins/plugin-catalog.js", () => ({ listPlugins: () => [] }));
vi.mock("../../skills/skill-service.js", () => ({
	getSkillBaseDir: () => "",
	readSkillsManifest: () => ({}),
}));

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-local-presentations-test-"));
	temporaryRoots.push(root);
	return root;
}

async function writeAbility(
	root: string,
	slug: string,
	type: "skill" | "scene" | "plugin",
	version: string,
	icon = "assets/icon.svg",
): Promise<void> {
	await mkdir(join(root, slug, "assets"), { recursive: true });
	await writeFile(join(root, slug, "assets", "icon.svg"), "<svg/>", "utf-8");
	await writeFile(
		join(root, slug, "ability.json"),
		JSON.stringify({ schemaVersion: 1, type, slug, version, icon, detail: { description: `${slug} detail` } }),
		"utf-8",
	);
}

function installedPlugin(rootPath: string, overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
	return {
		id: "feishu",
		name: "Feishu",
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "^2.0.0",
		entryUrl: "vetta-plugin://feishu/versions/1.0.0/mf-manifest.json",
		moduleFederation: { remoteName: "feishu", expose: "./plugin" },
		styleUrls: [],
		permissions: [],
		grantedPermissions: [],
		allowedNetworkHosts: [],
		allowedBrowserHosts: [],
		declaredCommands: [],
		grantedCommandNames: [],
		defaultLocale: "zh-CN",
		locales: {},
		enabled: true,
		required: false,
		installedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		source: "archive",
		trustLevel: "official",
		rootPath,
		...overrides,
	};
}

function dependencies(input: {
	builtinRoot?: string;
	installedRoot: string;
	plugins?: InstalledPlugin[];
}): LocalAbilityPresentationDependencies {
	const builtinManifest: Record<string, BuiltinSkillRegistration> = input.builtinRoot
		? { builtin: { name: "builtin", version: "2.0.0", source: "builtin", enabled: true, type: "skill" } }
		: {};
	return {
		getBuiltinSkillsDir: () => input.builtinRoot,
		readBuiltinSkillsManifest: () => builtinManifest,
		readSkillsManifest: () => ({
			installed: {
				name: "installed",
				version: "1.0.0",
				installedAt: "2026-01-01T00:00:00.000Z",
				source: "market",
				enabled: true,
				type: "skill",
			},
		}),
		getSkillBaseDir: () => input.installedRoot,
		listPlugins: () => input.plugins ?? [],
	};
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("listLocalAbilityPresentations", () => {
	it("materializes builtin, installed skill, and plugin package presentation in one read model", async () => {
		const builtinRoot = await temporaryRoot();
		const installedRoot = await temporaryRoot();
		const pluginParent = await temporaryRoot();
		await writeAbility(builtinRoot, "builtin", "skill", "2.0.0");
		await writeAbility(installedRoot, "installed", "skill", "1.0.0");
		await writeAbility(pluginParent, "feishu", "plugin", "1.0.0");

		const result = listLocalAbilityPresentations(
			dependencies({
				builtinRoot,
				installedRoot,
				plugins: [installedPlugin(join(pluginParent, "feishu"))],
			}),
		);

		expect(Object.keys(result).sort()).toEqual(["plugin:feishu", "skill:builtin", "skill:installed"]);
		expect(result["skill:installed"]?.icon).toContain("vetta-file://local/");
		expect(result["plugin:feishu"]?.icon).toBe("vetta-plugin://feishu/versions/1.0.0/assets/icon.svg?v=1.0.0");
		expect(result["plugin:feishu"]?.detail).toMatchObject({ description: "feishu detail" });
	});

	it("degrades one corrupt package without hiding healthy resources", async () => {
		const installedRoot = await temporaryRoot();
		const pluginRoot = await temporaryRoot();
		await writeAbility(installedRoot, "installed", "skill", "wrong-version");
		const plugin = installedPlugin(pluginRoot, { iconUrl: "solar:chat-bold" });

		const result = listLocalAbilityPresentations(dependencies({ installedRoot, plugins: [plugin] }));

		expect(result["skill:installed"]).toBeUndefined();
		expect(result["plugin:feishu"]).toEqual({ icon: "solar:chat-bold" });
	});
});
