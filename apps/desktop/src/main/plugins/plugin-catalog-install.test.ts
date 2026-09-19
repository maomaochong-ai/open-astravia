import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledPlugin, PluginManifest } from "../../preload/api-types/plugins.js";

const testPaths = vi.hoisted(() => {
	const root = `${process.cwd()}/.tmp-plugin-catalog-install-${process.pid}`;
	return { root, home: `${root}/home`, resources: `${root}/resources` };
});
const sendToRenderer = vi.hoisted(() => vi.fn());

vi.mock("@vetta/action-rpc", () => ({ getVettaHomePath: () => testPaths.home }));
vi.mock("electron", () => ({
	app: { isPackaged: true, resourcesPath: testPaths.resources },
	webContents: {
		getAllWebContents: () => [{ isDestroyed: () => false, send: sendToRenderer }],
	},
}));
vi.mock("../abilities/ability-ledger.js", () => ({
	recordAbilityInstall: vi.fn(),
	removeAbilityLedgerEntry: vi.fn(),
}));
vi.mock("../credentials/desktop-credential-vault.js", () => ({ getDesktopCredentialVault: () => ({}) }));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { recordAbilityInstall } from "../abilities/ability-ledger.js";
import { getPluginsBaseDir, installPluginFromArchive, installPluginFromPath } from "./plugin-catalog.js";

const PLUGIN_ID = "install-activation-demo";
const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");

function manifest(version: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
	return {
		id: PLUGIN_ID,
		name: `Demo ${version}`,
		version,
		pluginApiVersion: "^2.0.0",
		entry: "dist/mf-manifest.json",
		moduleFederation: { remoteName: "install_activation_demo", expose: "./plugin" },
		...overrides,
	};
}

/** 与用户手动安装的 zip 同构：根目录一个 plugin.json，外加打包产物。 */
function archive(version: string, overrides: Partial<PluginManifest> = {}): Buffer {
	const zip = new AdmZip();
	zip.addFile("plugin.json", Buffer.from(JSON.stringify(manifest(version, overrides))));
	zip.addFile("dist/mf-manifest.json", Buffer.from(JSON.stringify({ version })));
	return zip.toBuffer();
}

function activeEntryFile(plugin: InstalledPlugin): string {
	return readFileSync(join(plugin.rootPath, "dist/mf-manifest.json"), "utf-8");
}

beforeAll(async () => {
	Object.defineProperty(process, "resourcesPath", { configurable: true, value: testPaths.resources });
	await rm(testPaths.root, { recursive: true, force: true });
	await mkdir(join(testPaths.resources, "system-plugins"), { recursive: true });
	await mkdir(testPaths.home, { recursive: true });
});

beforeEach(() => {
	sendToRenderer.mockClear();
});

afterAll(async () => {
	await rm(testPaths.root, { recursive: true, force: true });
	if (originalResourcesPath) Object.defineProperty(process, "resourcesPath", originalResourcesPath);
	else Reflect.deleteProperty(process, "resourcesPath");
});

describe("installPluginFromArchive", () => {
	it("安装完成后只通知渲染进程重载目标插件", async () => {
		await installPluginFromArchive(archive("0.0.0"), { source: "archive" });

		expect(sendToRenderer).toHaveBeenCalledOnce();
		expect(sendToRenderer).toHaveBeenCalledWith("vetta:plugins:changed", { pluginIds: [PLUGIN_ID] });
	});

	it("从 .vettapkg 路径安装，并继续兼容旧 .zip 插件包", async () => {
		const packagePath = join(testPaths.root, "install-activation-demo-0.0.0.vettapkg");
		const legacyPath = join(testPaths.root, "install-activation-demo-0.0.0.zip");
		const invalidPath = join(testPaths.root, "plugin.tar");
		const bytes = archive("0.0.0");
		await Promise.all([writeFile(packagePath, bytes), writeFile(legacyPath, bytes), writeFile(invalidPath, bytes)]);

		await expect(installPluginFromPath(packagePath)).resolves.toMatchObject({ activeVersion: "0.0.0" });
		await expect(installPluginFromPath(legacyPath)).resolves.toMatchObject({ activeVersion: "0.0.0" });
		await expect(installPluginFromPath(invalidPath)).rejects.toThrow(".vettapkg");
	});

	it("手动装了新版本 zip 之后，无需任何重载动作就加载新版本内容", async () => {
		const first = await installPluginFromArchive(archive("0.0.1"), { source: "archive", enable: true });
		expect(first.activeVersion).toBe("0.0.1");
		expect(activeEntryFile(first)).toContain("0.0.1");

		const upgraded = await installPluginFromArchive(archive("0.0.2"), { source: "archive" });

		expect(upgraded.version).toBe("0.0.2");
		expect(upgraded.activeVersion).toBe("0.0.2");
		expect(upgraded.pendingVersion).toBeUndefined();
		expect(activeEntryFile(upgraded)).toContain("0.0.2");
		// 资源 URL 必须指向新版本，并带上让渲染进程丢弃旧远端的 reload token。
		expect(upgraded.entryUrl).toContain("/versions/0.0.2/dist/mf-manifest.json");
		expect(upgraded.entryUrl).toContain("&reload=");
		expect(upgraded.name).toBe("Demo 0.0.2");
		// 启用状态等用户态跨升级保留。
		expect(upgraded.enabled).toBe(true);
		expect(existsSync(join(getPluginsBaseDir(), PLUGIN_ID, "versions", "0.0.1"))).toBe(true);
		expect(recordAbilityInstall).toHaveBeenLastCalledWith("plugin", PLUGIN_ID, "0.0.2");
	});

	it("升级带来的新权限与新命令声明不会被自动授予", async () => {
		const granted = await installPluginFromArchive(
			archive("0.1.0", { permissions: ["agent.skills.control"], commands: ["demo.run"] }),
			{ source: "archive", grantedPermissions: ["agent.skills.control"] },
		);
		expect(granted.grantedPermissions).toEqual(["agent.skills.control"]);

		const upgraded = await installPluginFromArchive(
			archive("0.2.0", {
				permissions: ["agent.skills.control", "agent.command.run"],
				commands: ["demo.run", "demo.build"],
			}),
			{ source: "archive" },
		);

		expect(upgraded.activeVersion).toBe("0.2.0");
		expect(upgraded.permissions).toEqual(["agent.skills.control", "agent.command.run"]);
		expect(upgraded.grantedPermissions).toEqual(["agent.skills.control"]);
		expect(upgraded.declaredCommands).toEqual(["demo.run", "demo.build"]);
		expect(upgraded.grantedCommandNames).toEqual([]);
	});

	it("被移除的权限与命令在升级后从授权集合中消失", async () => {
		const upgraded = await installPluginFromArchive(archive("0.3.0"), { source: "archive" });

		expect(upgraded.permissions).toEqual([]);
		expect(upgraded.grantedPermissions).toEqual([]);
		expect(upgraded.declaredCommands).toEqual([]);
		expect(upgraded.grantedCommandNames).toEqual([]);
	});
});
