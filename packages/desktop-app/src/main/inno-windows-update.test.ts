import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CancellationError, type UpdateInfo } from "builder-util-runtime";
import type { ResolvedUpdateFileInfo } from "electron-updater";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	buildInnoUpdateArguments,
	InnoWindowsUpdateController,
	isVersionedWindowsExecutable,
	resolveInnoUpdateStoreRoot,
} from "./inno-windows-update.js";

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-inno-update-"));
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

describe("InnoWindowsUpdateController", () => {
	afterEach(async () => {
		await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	});

	it("prepares a downloaded installer, activates it, and marks the version healthy", async () => {
		const root = await createTemporaryRoot();
		const storeRoot = join(root, "store");
		const installer = Buffer.from("inno installer");
		const installerPath = join(root, "Vetta-1.2.3-win-x64.exe");
		await writeFile(installerPath, installer);
		const relaunch = vi.fn();
		const quit = vi.fn();
		const installInstaller = vi.fn(
			async (
				_installerPath: string,
				destinationRoot: string,
				version: string,
				onProgress: (percent: number) => void,
			) => {
				onProgress(50);
				const versionDir = join(destinationRoot, "versions", version);
				await mkdir(join(versionDir, "resources"), { recursive: true });
				await writeFile(join(versionDir, "Vetta.exe"), "executable");
				await writeFile(join(versionDir, "resources", "app.asar"), "asar");
				await writeFile(join(versionDir, ".install-complete"), version);
			},
		);
		const controller = new InnoWindowsUpdateController({
			currentVersion: "1.2.2",
			storeRoot,
			installInstaller,
			relaunch,
			quit,
		});

		expect(controller.select(createUpdateInfo(), createResolvedFiles(installer))).toEqual({
			assetFileName: "Vetta-1.2.3-win-x64.exe",
			totalBytes: installer.length,
		});
		const progress = vi.fn();
		const [executablePath] = await controller.prepareDownloadedInstaller(
			installerPath,
			progress,
			new AbortController().signal,
		);
		expect(executablePath).toBe(join(storeRoot, "versions", "1.2.3", "Vetta.exe"));
		expect(progress).toHaveBeenCalledWith(expect.objectContaining({ percent: 95 }));
		expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ percent: 100 }));

		await controller.activate();
		expect(relaunch).toHaveBeenCalledWith(executablePath);
		expect(quit).toHaveBeenCalledOnce();
		expect(JSON.parse(await readFile(join(storeRoot, "current.json"), "utf8"))).toEqual({
			version: "1.2.3",
			previousVersion: "1.2.2",
			pending: true,
		});

		const healthyController = new InnoWindowsUpdateController({
			currentVersion: "1.2.3",
			storeRoot,
			relaunch,
			quit,
		});
		await healthyController.markCurrentVersionHealthy();
		expect(JSON.parse(await readFile(join(storeRoot, "current.json"), "utf8"))).toEqual({
			version: "1.2.3",
			previousVersion: "1.2.2",
			pending: false,
		});
		expect(installInstaller).toHaveBeenCalledWith(
			installerPath,
			storeRoot,
			"1.2.3",
			expect.any(Function),
			expect.any(AbortSignal),
		);
	});

	it("retries physical cleanup of obsolete versions after the pointer is already healthy", async () => {
		const root = await createTemporaryRoot();
		const storeRoot = join(root, "store");
		const obsoleteAsar = join(storeRoot, "versions", "1.2.1", "resources", "app.asar");
		await mkdir(join(storeRoot, "versions", "1.2.1", "resources"), { recursive: true });
		await writeFile(obsoleteAsar, "obsolete");
		await mkdir(join(storeRoot, "versions", "1.2.2"), { recursive: true });
		await mkdir(join(storeRoot, "versions", "1.2.3"), { recursive: true });
		await writeFile(
			join(storeRoot, "current.json"),
			JSON.stringify({ version: "1.2.3", previousVersion: "1.2.2", pending: false }),
		);
		const controller = new InnoWindowsUpdateController({
			currentVersion: "1.2.3",
			storeRoot,
			relaunch: vi.fn(),
			quit: vi.fn(),
		});

		await controller.markCurrentVersionHealthy();

		await expect(readFile(obsoleteAsar)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readFile(join(storeRoot, "current.json"), "utf8")).resolves.toContain('"pending":false');
	});

	it("does not activate an incomplete Inno Setup installation", async () => {
		const root = await createTemporaryRoot();
		const storeRoot = join(root, "store");
		const installerPath = join(root, "Vetta-1.2.3-win-x64.exe");
		await writeFile(installerPath, "installer");
		const controller = new InnoWindowsUpdateController({
			currentVersion: "1.2.2",
			storeRoot,
			installInstaller: async (_installerPath, destinationRoot, version) => {
				const versionDir = join(destinationRoot, "versions", version);
				await mkdir(versionDir, { recursive: true });
				await writeFile(join(versionDir, "Vetta.exe"), "incomplete");
			},
			relaunch: vi.fn(),
			quit: vi.fn(),
		});
		controller.select(createUpdateInfo(), createResolvedFiles(Buffer.from("installer")));

		const abortController = new AbortController();
		setTimeout(() => abortController.abort(), 10);
		await expect(
			controller.prepareDownloadedInstaller(installerPath, vi.fn(), abortController.signal),
		).rejects.toBeInstanceOf(CancellationError);
		await expect(controller.activate()).rejects.toThrow("not ready");
	});

	it("waits for core files to become visible after a successful Inno installation", async () => {
		const root = await createTemporaryRoot();
		const storeRoot = join(root, "store");
		const installerPath = join(root, "Vetta-1.2.3-win-x64.exe");
		await writeFile(installerPath, "installer");
		const controller = new InnoWindowsUpdateController({
			currentVersion: "1.2.2",
			storeRoot,
			installInstaller: async (_installerPath, destinationRoot, version) => {
				const versionDir = join(destinationRoot, "versions", version);
				await mkdir(join(versionDir, "resources"), { recursive: true });
				await writeFile(join(versionDir, ".install-complete"), version);
				setTimeout(() => {
					void Promise.all([
						writeFile(join(versionDir, "Vetta.exe"), "executable"),
						writeFile(join(versionDir, "resources", "app.asar"), "asar"),
					]);
				}, 10);
			},
			relaunch: vi.fn(),
			quit: vi.fn(),
		});
		controller.select(createUpdateInfo(), createResolvedFiles(Buffer.from("installer")));

		await expect(
			controller.prepareDownloadedInstaller(installerPath, vi.fn(), new AbortController().signal),
		).resolves.toEqual([join(storeRoot, "versions", "1.2.3", "Vetta.exe")]);
	});

	it("validates installed files through the physical filesystem and restores ASAR handling", async () => {
		const root = await createTemporaryRoot();
		const storeRoot = join(root, "store");
		const installerPath = join(root, "Vetta-1.2.3-win-x64.exe");
		await writeFile(installerPath, "installer");
		const originalDescriptor = Object.getOwnPropertyDescriptor(process, "noAsar");
		const assignments: boolean[] = [];
		let noAsar = false;
		Object.defineProperty(process, "noAsar", {
			configurable: true,
			get: () => noAsar,
			set: (value: boolean) => {
				assignments.push(value);
				noAsar = value;
			},
		});

		try {
			const controller = new InnoWindowsUpdateController({
				currentVersion: "1.2.2",
				storeRoot,
				installInstaller: async (_installerPath, destinationRoot, version) => {
					const versionDir = join(destinationRoot, "versions", version);
					await mkdir(join(versionDir, "resources"), { recursive: true });
					await writeFile(join(versionDir, "Vetta.exe"), "executable");
					await writeFile(join(versionDir, "resources", "app.asar"), "asar");
					await writeFile(join(versionDir, ".install-complete"), version);
				},
				relaunch: vi.fn(),
				quit: vi.fn(),
			});
			controller.select(createUpdateInfo(), createResolvedFiles(Buffer.from("installer")));

			await controller.prepareDownloadedInstaller(installerPath, vi.fn(), new AbortController().signal);

			expect(assignments).toContain(true);
			expect(noAsar).toBe(false);
		} finally {
			if (originalDescriptor) Object.defineProperty(process, "noAsar", originalDescriptor);
			else Reflect.deleteProperty(process, "noAsar");
		}
	});

	it("rejects a failed installer even when it leaves core files behind", async () => {
		const root = await createTemporaryRoot();
		const storeRoot = join(root, "store");
		const installerPath = join(root, "Vetta-1.2.3-win-x64.exe");
		await writeFile(installerPath, "installer");
		const controller = new InnoWindowsUpdateController({
			currentVersion: "1.2.2",
			storeRoot,
			installInstaller: async (_installerPath, destinationRoot, version) => {
				const versionDir = join(destinationRoot, "versions", version);
				await mkdir(join(versionDir, "resources"), { recursive: true });
				await writeFile(join(versionDir, "Vetta.exe"), "executable");
				await writeFile(join(versionDir, "resources", "app.asar"), "asar");
				throw new Error("Inno Setup exited with code 5");
			},
			relaunch: vi.fn(),
			quit: vi.fn(),
		});
		controller.select(createUpdateInfo(), createResolvedFiles(Buffer.from("installer")));

		await expect(
			controller.prepareDownloadedInstaller(installerPath, vi.fn(), new AbortController().signal),
		).rejects.toThrow("Inno Setup exited with code 5");
	});

	it("removes an incomplete version before retrying the installer", async () => {
		const root = await createTemporaryRoot();
		const storeRoot = join(root, "store");
		const versionDir = join(storeRoot, "versions", "1.2.3");
		const installerPath = join(root, "Vetta-1.2.3-win-x64.exe");
		await mkdir(versionDir, { recursive: true });
		await writeFile(join(versionDir, "stale.txt"), "stale");
		await writeFile(installerPath, "installer");
		const controller = new InnoWindowsUpdateController({
			currentVersion: "1.2.2",
			storeRoot,
			installInstaller: async (_installerPath, destinationRoot, version) => {
				const destinationDir = join(destinationRoot, "versions", version);
				await expect(readFile(join(destinationDir, "stale.txt"), "utf8")).rejects.toThrow();
				await mkdir(join(destinationDir, "resources"), { recursive: true });
				await writeFile(join(destinationDir, "Vetta.exe"), "executable");
				await writeFile(join(destinationDir, "resources", "app.asar"), "asar");
				await writeFile(join(destinationDir, ".install-complete"), version);
			},
			relaunch: vi.fn(),
			quit: vi.fn(),
		});
		controller.select(createUpdateInfo(), createResolvedFiles(Buffer.from("installer")));

		await expect(
			controller.prepareDownloadedInstaller(installerPath, vi.fn(), new AbortController().signal),
		).resolves.toEqual([join(versionDir, "Vetta.exe")]);
	});
});

describe("Windows Inno update paths", () => {
	it("recognizes only executables inside the matching version directory", () => {
		expect(isVersionedWindowsExecutable("C:\\Vetta\\versions\\1.2.3\\Vetta.exe", "1.2.3")).toBe(true);
		expect(isVersionedWindowsExecutable("C:\\Vetta\\Vetta.exe", "1.2.3")).toBe(false);
		expect(isVersionedWindowsExecutable("C:\\Vetta\\versions\\1.2.2\\Vetta.exe", "1.2.3")).toBe(false);
	});

	it("uses the stable per-user application root", () => {
		expect(resolveInnoUpdateStoreRoot("C:\\Users\\test\\AppData\\Local")).toBe(
			"C:\\Users\\test\\AppData\\Local\\Vetta",
		);
	});

	it("builds a fully silent background update command", () => {
		expect(buildInnoUpdateArguments("C:\\Store Root", "C:\\Temp\\progress", "C:\\Temp\\install.log")).toEqual(
			expect.arrayContaining([
				"/VERYSILENT",
				"/SUPPRESSMSGBOXES",
				"/NOCLOSEAPPLICATIONS",
				"/VETTAUPDATE=true",
				"/VETTASTOREROOT=C:\\Store Root",
			]),
		);
	});
});
