import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { InstalledPlugin } from "../../../preload/api-types/plugins";
import {
	installedPluginAssetUrl,
	loadInstalledPluginPackagePresentation,
	resolveInstalledPluginPresentationIcon,
} from "./installed-plugin-presentation";

const temporaryRoots: string[] = [];

function plugin(rootPath: string, overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
	return {
		id: "feishu",
		name: "Feishu",
		version: "1.2.3",
		activeVersion: "1.2.3",
		pluginApiVersion: "^2.0.0",
		entryUrl: "vetta-plugin://feishu/versions/1.2.3/mf-manifest.json",
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

async function createPluginPackage(icon?: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-plugin-presentation-test-"));
	temporaryRoots.push(root);
	if (icon) {
		await mkdir(join(root, "assets"));
		await writeFile(join(root, "assets", "icon.png"), "image", "utf-8");
		await writeFile(
			join(root, "ability.json"),
			JSON.stringify({ schemaVersion: 1, type: "plugin", slug: "feishu", version: "1.2.3", icon }),
			"utf-8",
		);
	}
	return root;
}

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("installed plugin presentation", () => {
	it("uses ability.json when plugin.json did not declare an icon", async () => {
		const installed = plugin(await createPluginPackage("assets/icon.png"));
		const presentation = loadInstalledPluginPackagePresentation(installed);

		expect(resolveInstalledPluginPresentationIcon(installed, presentation)).toBe(
			"vetta-plugin://feishu/versions/1.2.3/assets/icon.png?v=1.2.3",
		);
	});

	it("prefers ability.json over the plugin manifest icon", async () => {
		const installed = plugin(await createPluginPackage("assets/icon.png"), { iconUrl: "solar:chat-bold" });
		expect(resolveInstalledPluginPresentationIcon(installed)).toContain("assets/icon.png");
	});

	it("falls back to the plugin manifest icon when ability.json is absent", async () => {
		const installed = plugin(await createPluginPackage(), { iconUrl: "solar:chat-bold" });
		expect(resolveInstalledPluginPresentationIcon(installed)).toBe("solar:chat-bold");
	});

	it("refuses to map a file outside the plugin package", async () => {
		const root = await createPluginPackage();
		expect(() => installedPluginAssetUrl(plugin(root), join(root, "..", "outside.png"))).toThrow(
			"escapes package root",
		);
	});
});
