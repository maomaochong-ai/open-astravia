import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UpdateInfo } from "builder-util-runtime";
import type { ResolvedUpdateFileInfo } from "electron-updater";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	isVersionedWindowsExecutable,
	resolveStagedUpdateStoreRoot,
	resolveWindowsUpdateExtractorPath,
	StagedWindowsUpdateController,
} from "./staged-windows-update.js";

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-staged-update-"));
	temporaryRoots.push(root);
	return root;
}

function createUpdateInfo(): UpdateInfo {
	return {
		version: "1.2.3",
		files: [],
		path: "Vetta-1.2.3-win-x64.exe",
		sha512: "installer",
		releaseDate: new Date().toISOString(),
	};
}

function createResolvedFiles(content: Buffer): Array<ResolvedUpdateFileInfo> {
	return [
		{
			url: new URL("https://releases.example.com/Vetta-1.2.3-win-x64.exe"),
			info: {
				url: "Vetta-1.2.3-win-x64.exe",
				sha512: "installer",
				size: content.length,
			},
		},
	];
}

describe("StagedWindowsUpdateController", () => {
	afterEach(async () => {
		await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	});

	it("extracts a downloaded installer, activates it, and marks the version healthy", async () => {
		const root = await createTemporaryRoot();
		const storeRoot = join(root, "store");
		const installer = Buffer.from("staged installer");
		const installerPath = join(root, "Vetta-1.2.3-win-x64.exe");
		await writeFile(installerPath, installer);
		const incompleteVersionDir = join(storeRoot, "versions", "1.2.3");
		await mkdir(incompleteVersionDir, { recursive: true });
		await writeFile(join(incompleteVersionDir, "Vetta.exe"), "incomplete");
		const relaunch = vi.fn();
		const quit = vi.fn();
		const extractInstaller = vi.fn(async (_installerPath: string, destination: string) => {
			const versionDir = join(destination, "versions", "1.2.3");
			await mkdir(join(versionDir, "resources"), { recursive: true });
			await writeFile(join(versionDir, "Vetta.exe"), "executable");
			await writeFile(join(versionDir, "resources", "app.asar"), "asar");
		});
		const controller = new StagedWindowsUpdateController({
			currentVersion: "1.2.2",
			storeRoot,
			extractorPath: "C:\\Vetta\\resources\\tools\\7zip\\7z.exe",
			extractInstaller,
			relaunch,
			quit,
		});

		expect(controller.select(createUpdateInfo(), createResolvedFiles(installer))).toEqual({
			assetFileName: "Vetta-1.2.3-win-x64.exe",
			totalBytes: installer.length,
		});
		const progress = vi.fn();
		const [executablePath] = await controller.stageDownloadedInstaller(
			installerPath,
			progress,
			new AbortController().signal,
		);
		expect(executablePath).toBe(join(storeRoot, "versions", "1.2.3", "Vetta.exe"));
		expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ percent: 100 }));

		await controller.activate();
		expect(relaunch).toHaveBeenCalledWith(executablePath);
		expect(quit).toHaveBeenCalledOnce();
		expect(JSON.parse(await readFile(join(storeRoot, "current.json"), "utf8"))).toEqual({
			version: "1.2.3",
			previousVersion: "1.2.2",
			pending: true,
		});

		const healthyController = new StagedWindowsUpdateController({
			currentVersion: "1.2.3",
			storeRoot,
			extractorPath: "C:\\Vetta\\resources\\tools\\7zip\\7z.exe",
			relaunch,
			quit,
		});
		await healthyController.markCurrentVersionHealthy();
		expect(JSON.parse(await readFile(join(storeRoot, "current.json"), "utf8"))).toEqual({
			version: "1.2.3",
			previousVersion: "1.2.2",
			pending: false,
		});
		expect(extractInstaller).toHaveBeenCalledWith(installerPath, storeRoot, "1.2.3", expect.any(AbortSignal));
	});

	it("rejects an installer that does not contain a complete version", async () => {
		const root = await createTemporaryRoot();
		const installer = Buffer.from("staged installer");
		const installerPath = join(root, "Vetta-1.2.3-win-x64.exe");
		await writeFile(installerPath, installer);
		const controller = new StagedWindowsUpdateController({
			currentVersion: "1.2.2",
			storeRoot: join(root, "store"),
			extractorPath: "C:\\Vetta\\resources\\tools\\7zip\\7z.exe",
			extractInstaller: async (_installerPath, destination) => {
				const versionDir = join(destination, "versions", "1.2.3");
				await mkdir(versionDir, { recursive: true });
				await writeFile(join(versionDir, "Vetta.exe"), "executable");
			},
			relaunch: vi.fn(),
			quit: vi.fn(),
		});
		controller.select(createUpdateInfo(), createResolvedFiles(installer));

		await expect(
			controller.stageDownloadedInstaller(installerPath, vi.fn(), new AbortController().signal),
		).rejects.toThrow(/Expected file/);
	});
});

describe("Windows staged update paths", () => {
	it("recognizes only executables inside the matching version directory", () => {
		expect(isVersionedWindowsExecutable("C:\\Vetta\\versions\\1.2.3\\Vetta.exe", "1.2.3")).toBe(true);
		expect(isVersionedWindowsExecutable("C:\\Vetta\\Vetta.exe", "1.2.3")).toBe(false);
		expect(isVersionedWindowsExecutable("C:\\Vetta\\versions\\1.2.2\\Vetta.exe", "1.2.3")).toBe(false);
	});

	it("uses the stable per-user application root", () => {
		expect(resolveStagedUpdateStoreRoot("C:\\Users\\test\\AppData\\Local")).toBe(
			"C:\\Users\\test\\AppData\\Local\\OpenVetta\\Desktop",
		);
	});

	it("resolves the packaged Windows 7-Zip binary", () => {
		expect(resolveWindowsUpdateExtractorPath("C:\\Vetta\\resources")).toBe(
			"C:\\Vetta\\resources\\tools\\7zip\\7z.exe",
		);
	});
});
