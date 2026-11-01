import { spawn } from "node:child_process";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	createMacUnsignedInstallScript,
	inspectMacBundleSignature,
	installerLogPath,
	isUnsignedMacBundle,
	launchMacUnsignedInstaller,
	shellQuote,
} from "./mac-unsigned-installer";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "astravia-unsigned-"));
	temporaryRoots.push(root);
	return root;
}

/** 造一个「旧版本」bundle：带 Info.plist，内容只有一个能被读到的版本文件。 */
async function writeFakeApp(appPath: string, version: string): Promise<void> {
	const contents = join(appPath, "Contents");
	await mkdirRecursive(join(contents, "MacOS"));
	await writeFile(join(contents, "Info.plist"), "<plist/>", "utf8");
	await writeFile(join(contents, "MacOS", "version.txt"), version, "utf8");
}

async function mkdirRecursive(path: string): Promise<void> {
	const { mkdir } = await import("node:fs/promises");
	await mkdir(path, { recursive: true });
}

/** 用 ditto 打一个真 ZIP，让脚本走真实的解包路径。 */
async function zipDirectory(source: string, archivePath: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", source, archivePath], { stdio: "ignore" });
		child.once("error", reject);
		child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ditto exited with ${code}`))));
	});
}

/** 一个已经退出的 PID：脚本的等待循环会立刻放行。 */
async function exitedPid(): Promise<number> {
	const child = spawn("/bin/sh", ["-c", "exit 0"], { stdio: "ignore" });
	const pid = child.pid;
	await new Promise<void>((resolve) => child.once("exit", () => resolve()));
	if (!pid) throw new Error("failed to spawn helper process");
	return pid;
}

/** 启动一个短命进程，返回它的 PID：脚本要等到它退出才动文件。 */
async function spawnShortLivedProcess(): Promise<number> {
	const child = spawn("/bin/sh", ["-c", "sleep 0.4"], { stdio: "ignore" });
	await new Promise<void>((resolve) => child.once("spawn", () => resolve()));
	const pid = child.pid;
	if (!pid) throw new Error("failed to spawn helper process");
	return pid;
}

/** 假的「重启命令」：把收到的参数记到文件，供用例断言是否真的拉起了应用。 */
async function writeRelaunchRecorder(root: string): Promise<{ scriptPath: string; markerPath: string }> {
	const scriptPath = join(root, "relaunch-recorder.sh");
	const markerPath = join(root, "relaunch-calls.txt");
	await writeFile(scriptPath, `#!/bin/bash\necho "$1" >> ${JSON.stringify(markerPath)}\n`, "utf8");
	await chmod(scriptPath, 0o755);
	return { scriptPath, markerPath };
}

/**
 * 脚本本身是纯文本，可以任何平台断言；真正跑 `bash` + `ditto` 的用例只在 macOS
 * 成立——CI 的 ubuntu / windows runner 上没有这些命令，也不存在 `.app` 这种布局。
 */
const onMacOS = process.platform === "darwin";

describe("mac unsigned installer", () => {
	afterEach(async () => {
		await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
	});

	it("waits for the running process before swapping the bundle in", async () => {
		const script = createMacUnsignedInstallScript({
			appPath: "/Applications/Astravia.app",
			archivePath: "/Users/me/Library/Caches/astravia-updater/pending/Astravia-0.5.81-arm64-mac.zip",
			pid: 4242,
			logPath: "/tmp/install.log",
		});

		// 顺序即正确性：先等 PID 消失，再解包，再换包，最后去 quarantine 并重启。
		const wait = script.indexOf("/bin/kill -0 4242");
		const unzip = script.indexOf("/usr/bin/ditto -x -k");
		const swap = script.indexOf('/bin/mv "$APP" "$BACKUP"');
		const quarantine = script.lastIndexOf("/usr/bin/xattr -dr com.apple.quarantine");
		const relaunch = script.indexOf('relaunch_app || abort "relaunch failed"');
		expect(wait).toBeGreaterThan(-1);
		expect(unzip).toBeGreaterThan(wait);
		expect(swap).toBeGreaterThan(unzip);
		expect(quarantine).toBeGreaterThan(swap);
		expect(relaunch).toBeGreaterThan(quarantine);
	});

	it("quotes paths so a bundle with spaces or quotes is not split", () => {
		expect(shellQuote("/Applications/My App.app")).toBe("'/Applications/My App.app'");
		expect(shellQuote("it's here")).toBe("'it'\\''s here'");
		const script = createMacUnsignedInstallScript({
			appPath: "/Volumes/My Disk/Astravia.app",
			archivePath: "/tmp/a b.zip",
			pid: 1,
			logPath: "/tmp/log with space.log",
		});
		expect(script).toContain("APP='/Volumes/My Disk/Astravia.app'");
		expect(script).toContain("ARCHIVE='/tmp/a b.zip'");
	});

	it.skipIf(!onMacOS)("replaces the bundle and relaunches, end to end", async () => {
		const root = await temporaryRoot();
		const appPath = join(root, "Applications", "Astravia.app");
		await writeFakeApp(appPath, "0.5.80");

		// 新版包：解包后脚本应当把它整体搬过去。
		const staging = join(root, "staging");
		await writeFakeApp(join(staging, "Astravia.app"), "0.5.81");
		const archivePath = join(root, "Astravia-0.5.81-arm64-mac.zip");
		// 与 electron-builder 一致：归档根是 `Astravia.app/`，不是它的内容。
		await zipDirectory(staging, archivePath);

		const pid = await spawnShortLivedProcess();
		const scriptPath = await launchMacUnsignedInstaller({
			appPath,
			archivePath,
			pid,
			cacheRoot: join(root, "cache"),
			scriptName: "0.5.81",
			waitMs: 10_000,
			relaunch: "/usr/bin/true",
			dryRun: true,
		});

		await new Promise<void>((resolve, reject) => {
			const child = spawn("/bin/bash", [scriptPath], { stdio: "ignore" });
			child.once("error", reject);
			child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`installer exited with ${code}`))));
		});

		await expect(readFile(join(appPath, "Contents", "MacOS", "version.txt"), "utf8")).resolves.toBe("0.5.81");
		// 备份目录必须清干净，否则下次启动会把两个 bundle 都当候选。
		await expect(readFile(`${appPath}.old/Contents/MacOS/version.txt`, "utf8")).rejects.toThrow();
	});

	it.skipIf(!onMacOS)("leaves the bundle untouched when the old process never exits", async () => {
		const root = await temporaryRoot();
		const appPath = join(root, "Astravia.app");
		await writeFakeApp(appPath, "0.5.80");
		const scriptPath = await launchMacUnsignedInstaller({
			appPath,
			archivePath: join(root, "unused.zip"),
			pid: process.pid,
			cacheRoot: join(root, "cache"),
			scriptName: "alive",
			waitMs: 600,
			relaunch: "/usr/bin/true",
			dryRun: true,
		});

		const exitCode = await new Promise<number | null>((resolve, reject) => {
			const child = spawn("/bin/bash", [scriptPath], { stdio: "ignore" });
			child.once("error", reject);
			child.once("exit", (code) => resolve(code));
		});
		expect(exitCode).toBe(1);
		await expect(readFile(join(appPath, "Contents", "MacOS", "version.txt"), "utf8")).resolves.toBe("0.5.80");
	});

	it.skipIf(!onMacOS)("keeps the old bundle when the archive cannot be unpacked", async () => {
		const root = await temporaryRoot();
		const appPath = join(root, "Astravia.app");
		await writeFakeApp(appPath, "0.5.80");
		const archivePath = join(root, "broken.zip");
		await writeFile(archivePath, "not a zip", "utf8");

		const scriptPath = await launchMacUnsignedInstaller({
			appPath,
			archivePath,
			pid: await exitedPid(),
			cacheRoot: join(root, "cache"),
			scriptName: "broken",
			waitMs: 5_000,
			relaunch: "/usr/bin/true",
			dryRun: true,
		});

		// 已退出的 PID 让脚本立刻越过等待，直接撞上解包失败。
		const exitCode = await new Promise<number | null>((resolve, reject) => {
			const child = spawn("/bin/bash", [scriptPath], { stdio: "ignore", env: { ...process.env } });
			child.once("error", reject);
			child.once("exit", (code) => resolve(code));
		});
		expect(exitCode).toBe(1);
		await expect(readFile(join(appPath, "Contents", "MacOS", "version.txt"), "utf8")).resolves.toBe("0.5.80");
	});

	it.skipIf(!onMacOS)("relaunches the installed app even when the update cannot be applied", async () => {
		const root = await temporaryRoot();
		const appPath = join(root, "Astravia.app");
		await writeFakeApp(appPath, "0.5.80");
		const archivePath = join(root, "broken.zip");
		await writeFile(archivePath, "not a zip", "utf8");
		const recorder = await writeRelaunchRecorder(root);

		const scriptPath = await launchMacUnsignedInstaller({
			appPath,
			archivePath,
			pid: await exitedPid(),
			cacheRoot: join(root, "cache"),
			scriptName: "broken-relaunch",
			waitMs: 5_000,
			relaunch: recorder.scriptPath,
			dryRun: true,
		});

		const exitCode = await new Promise<number | null>((resolve, reject) => {
			const child = spawn("/bin/bash", [scriptPath], { stdio: "ignore" });
			child.once("error", reject);
			child.once("exit", (code) => resolve(code));
		});

		// 交棒后应用已经退出：解包失败也不能把用户留在桌面全空，至少要拉回旧版本。
		expect(exitCode).toBe(1);
		await expect(readFile(recorder.markerPath, "utf8")).resolves.toContain(appPath);
		await expect(readFile(join(appPath, "Contents", "MacOS", "version.txt"), "utf8")).resolves.toBe("0.5.80");
	});

	it.skipIf(!onMacOS)("does not start a second copy while the old process is still running", async () => {
		const root = await temporaryRoot();
		const appPath = join(root, "Astravia.app");
		await writeFakeApp(appPath, "0.5.80");
		const recorder = await writeRelaunchRecorder(root);

		const scriptPath = await launchMacUnsignedInstaller({
			appPath,
			archivePath: join(root, "unused.zip"),
			pid: process.pid,
			cacheRoot: join(root, "cache"),
			scriptName: "alive-relaunch",
			waitMs: 400,
			relaunch: recorder.scriptPath,
			dryRun: true,
		});

		const exitCode = await new Promise<number | null>((resolve, reject) => {
			const child = spawn("/bin/bash", [scriptPath], { stdio: "ignore" });
			child.once("error", reject);
			child.once("exit", (code) => resolve(code));
		});

		// 旧实例还活着时再拉起一个会变成双开，让用户自己关旧窗口。
		expect(exitCode).toBe(1);
		await expect(access(recorder.markerPath)).rejects.toThrow();
	});

	it("treats an ad-hoc bundle as one Squirrel cannot verify", () => {
		// 不依赖本机签名状态：只验证判定函数在「无 Developer ID」时返回 true。
		expect(isUnsignedMacBundle("/nonexistent/Astravia.app")).toBe(process.platform === "darwin");
	});

	it("reports why a bundle cannot be handed to Squirrel", () => {
		// 探针结论要能落到日志：真实发布包报的正是「没有 CodeResources」。
		const report = inspectMacBundleSignature("/nonexistent/Astravia.app");
		if (process.platform !== "darwin") {
			expect(report.unsigned).toBe(false);
			return;
		}
		expect(report).toEqual({ unsigned: true, reason: "no Contents/_CodeSignature/CodeResources" });
	});

	it("keeps the log next to the script", () => {
		expect(installerLogPath("/tmp/cache", "0.5.81")).toBe("/tmp/cache/install-0.5.81.log");
	});
});
