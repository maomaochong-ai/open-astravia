// Appshot 捕获主流程：手势触发 → 权限检查 → spawn Swift helper 抓前台窗口
// （截图 PNG + AX 结构化文本 + 源文件路径）→ 落盘 ~/.vetta/image-cache/appshot/
// → 唤起主窗并推送 CAPTURED。文本层只用辅助功能（AX）；抓不到就只带截图，
// 由 agent 自行用视觉/OCR 能力理解，不在捕获阶段做 OCR。日志走 getAppLogger("appshot")。

import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import {
	APPSHOT_CHANNELS,
	type AppshotCapturedPayload,
	type AppshotCaptureErrorPayload,
	type AppshotCaptureErrorReason,
} from "../../shared/appshot-ipc.js";
import type { HelperPermissions } from "../../shared/onboarding-ipc.js";
import { readDesktopConfig } from "../ipc/fs.js";
import { getAppLogger } from "../logger.js";
import { getMainWindow, showMainWindow } from "../window-manager.js";
import { clearHelperQuarantine, resolveAppshotHelperBinary } from "./helper-resolver.js";

export type { HelperPermissions };

const log = getAppLogger("appshot");

/** helper 抓取总超时（ms）：AX 遍历大窗口可能较慢，超时即 kill。 */
const HELPER_TIMEOUT_MS = 30_000;
/** helper 权限查询/请求超时（ms）。 */
const PERMISSIONS_TIMEOUT_MS = 30_000;

// macOS 系统截图快门音效路径，通过 afplay 播放
const SCREENSHOT_SOUND =
	"/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system/Screen Capture.aif";

interface HelperSuccess {
	ok: true;
	appName: string;
	bundleId: string;
	windowTitle: string;
	documentPath: string | null;
	axText: string | null;
	pngPath: string | null;
	iconPath: string | null;
}

interface HelperFailure {
	ok: false;
	error: string;
	message?: string;
}

type HelperResult = HelperSuccess | HelperFailure;

interface AppshotMeta {
	appName: string;
	windowTitle: string;
	documentPath: string | null;
	capturedAt: number;
}

/** 落盘目录：~/.vetta/image-cache/appshot/（复用 dialog.ts 的 7 天 TTL 目录清理）。 */
function appshotCacheDir(): string {
	return join(getVettaHomePath(), "image-cache", "appshot");
}

/** 本地时区 ISO 时间串（带 +08:00 形式的偏移），写进 md frontmatter。 */
function toLocalIso(date: Date): string {
	const pad = (n: number): string => String(n).padStart(2, "0");
	const offsetMin = -date.getTimezoneOffset();
	const sign = offsetMin >= 0 ? "+" : "-";
	const abs = Math.abs(offsetMin);
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
		`${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
	);
}

// JSON 字符串是合法的 YAML 双引号标量：把动态值（可含换行/引号/"---"）安全地转义进 frontmatter，
// 防止窗口标题等注入伪造的元数据行或提前闭合 frontmatter。
function yamlStr(value: string): string {
	return JSON.stringify(value);
}

function buildMarkdown(meta: AppshotMeta, body: string): string {
	const lines = ["---", `app: ${yamlStr(meta.appName)}`, `window: ${yamlStr(meta.windowTitle)}`];
	if (meta.documentPath) lines.push(`source_file: ${yamlStr(meta.documentPath)}`);
	lines.push(
		`captured_at: ${toLocalIso(new Date(meta.capturedAt))}`,
		"text_source: accessibility",
		"---",
		"",
		body,
		"",
	);
	return lines.join("\n");
}

function sendToMainWindow(channel: string, payload: unknown): void {
	const win = getMainWindow();
	if (win && !win.isDestroyed()) {
		win.webContents.send(channel, payload);
	}
}

function sendCaptureError(reason: AppshotCaptureErrorReason): void {
	const payload: AppshotCaptureErrorPayload = { reason };
	sendToMainWindow(APPSHOT_CHANNELS.CAPTURE_ERROR, payload);
}

/** spawn helper 并解析其 stdout JSON；超时/非 JSON 输出按异常抛出。 */
function runHelper(outDir: string, noScreenshot: boolean): Promise<HelperResult> {
	const bin = resolveAppshotHelperBinary();
	const args = ["--out-dir", outDir, "--exclude-pid", String(process.pid)];
	if (noScreenshot) args.push("--no-screenshot");
	clearHelperQuarantine();
	return new Promise<HelperResult>((resolvePromise, rejectPromise) => {
		const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill("SIGKILL");
			rejectPromise(new Error(`appshot helper timed out after ${HELPER_TIMEOUT_MS}ms`));
		}, HELPER_TIMEOUT_MS);
		child.stdout.on("data", (chunk: Buffer) => {
			stdoutChunks.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});
		child.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			rejectPromise(err);
		});
		child.on("close", () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			const stdout = Buffer.concat(stdoutChunks).toString("utf8");
			const stderr = Buffer.concat(stderrChunks).toString("utf8");
			try {
				resolvePromise(JSON.parse(stdout) as HelperResult);
			} catch {
				rejectPromise(new Error(`appshot helper output is not JSON: ${(stderr || stdout).slice(0, 500)}`));
			}
		});
	});
}

/** spawn helper 以 --check-permissions/--request-permissions 模式，解析 {accessibility,screenRecording} JSON。 */
function runHelperPermissionsMode(mode: "--check-permissions" | "--request-permissions"): Promise<HelperPermissions> {
	const bin = resolveAppshotHelperBinary();
	clearHelperQuarantine();
	return new Promise<HelperPermissions>((resolvePromise, rejectPromise) => {
		const child = spawn(bin, [mode], { stdio: ["ignore", "pipe", "pipe"] });
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill("SIGKILL");
			rejectPromise(new Error(`appshot helper ${mode} timed out after ${PERMISSIONS_TIMEOUT_MS}ms`));
		}, PERMISSIONS_TIMEOUT_MS);
		child.stdout.on("data", (chunk: Buffer) => {
			stdoutChunks.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});
		child.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			rejectPromise(err);
		});
		child.on("close", () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			const stdout = Buffer.concat(stdoutChunks).toString("utf8");
			const stderr = Buffer.concat(stderrChunks).toString("utf8");
			try {
				const parsed = JSON.parse(stdout) as { accessibility?: unknown; screenRecording?: unknown };
				resolvePromise({
					accessibility: parsed.accessibility === true,
					screenRecording: parsed.screenRecording === true,
				});
			} catch {
				rejectPromise(new Error(`appshot helper ${mode} output is not JSON: ${(stderr || stdout).slice(0, 500)}`));
			}
		});
	});
}

// in-flight 合流：多个调用方（主窗口 PermissionsSettings、引导窗 OnboardingApp）可能在同一时刻
// 各自因 window focus 触发权限查询/请求，不去重会并发 spawn 多个 helper 子进程，且后 resolve 的
// 调用可能覆盖先 resolve 的更新的 UI 状态。查/请求各自独立合流（语义不同，不能共用一个 in-flight）。
let checkPermissionsInFlight: Promise<HelperPermissions> | null = null;
let requestPermissionsInFlight: Promise<HelperPermissions> | null = null;

/** 查询 helper（独立 TCC 主体）当前的辅助功能/屏幕录制权限状态，不弹系统授权框。 */
export function checkHelperPermissions(): Promise<HelperPermissions> {
	if (process.platform !== "darwin") return Promise.resolve({ accessibility: false, screenRecording: false });
	if (checkPermissionsInFlight) return checkPermissionsInFlight;
	const task = runHelperPermissionsMode("--check-permissions")
		.catch((err) => {
			log.warn("checkHelperPermissions failed", err);
			return { accessibility: false, screenRecording: false };
		})
		.finally(() => {
			checkPermissionsInFlight = null;
		});
	checkPermissionsInFlight = task;
	return task;
}

/** 触发 helper 弹系统权限授权框（引导流程用），返回请求后的最新状态。 */
export function requestHelperPermissions(): Promise<HelperPermissions> {
	if (process.platform !== "darwin") return Promise.resolve({ accessibility: false, screenRecording: false });
	if (requestPermissionsInFlight) return requestPermissionsInFlight;
	const task = runHelperPermissionsMode("--request-permissions")
		.catch((err) => {
			log.warn("requestHelperPermissions failed", err);
			return { accessibility: false, screenRecording: false };
		})
		.finally(() => {
			requestPermissionsInFlight = null;
		});
	requestPermissionsInFlight = task;
	return task;
}

// ----- 捕获主流程 -------------------------------------------------------------

let captureInFlight = false;

/** 手势触发入口：整个流程失败时兜底推 CAPTURE_ERROR，绝不向上抛。 */
export async function captureAppshot(): Promise<void> {
	if (captureInFlight) return; // 手势连击去抖：一次只跑一个捕获
	captureInFlight = true;
	try {
		await doCapture();
	} catch (err) {
		log.error("appshot capture failed", err);
		sendCaptureError("helper-failed");
	} finally {
		captureInFlight = false;
	}
}

async function doCapture(): Promise<void> {
	// 双保险：监听在 disabled 时本不应注册目标键，这里再核对一次配置。
	const config = await readDesktopConfig();
	if (config.appshot?.enabled !== true) return;

	const permissions = await checkHelperPermissions();
	if (!permissions.accessibility && !permissions.screenRecording) {
		showMainWindow();
		sendCaptureError("no-permission");
		return;
	}

	const dir = appshotCacheDir();
	await mkdir(dir, { recursive: true });
	const result = await runHelper(dir, !permissions.screenRecording);
	if (!result.ok) {
		log.warn("helper reported failure", { error: result.error, message: result.message });
		sendCaptureError(result.error === "self-capture" ? "self-capture" : "helper-failed");
		return;
	}

	const id = `appshot-${Date.now()}`;
	const capturedAt = Date.now();
	const appName = typeof result.appName === "string" ? result.appName : "";
	const windowTitle = typeof result.windowTitle === "string" ? result.windowTitle : "";
	const documentPath = typeof result.documentPath === "string" && result.documentPath ? result.documentPath : null;
	const meta: AppshotMeta = { appName, windowTitle, documentPath, capturedAt };

	// 截图归一到 <id>.png（helper 写在同目录，rename 不跨设备）。
	// rename 失败时不回退到 helper 写死的共享路径（会被下次捕获覆盖），改用 copy 到同样唯一的
	// 目标路径兜底，成功后尽力清理原文件。
	let imagePath: string | null = null;
	if (typeof result.pngPath === "string" && result.pngPath) {
		const target = join(dir, `${id}.png`);
		try {
			await rename(result.pngPath, target);
			imagePath = target;
		} catch (err) {
			log.warn("failed to rename capture png, falling back to copy", err);
			try {
				await copyFile(result.pngPath, target);
				imagePath = target;
				await unlink(result.pngPath).catch(() => {});
			} catch (copyErr) {
				log.warn("failed to copy capture png, keep original path", copyErr);
				imagePath = result.pngPath;
			}
		}
	}

	// 应用图标归一到 <id>-icon.png（helper 写在同目录，rename 不跨设备）。
	let iconPath: string | null = null;
	if (typeof result.iconPath === "string" && result.iconPath) {
		const target = join(dir, `${id}-icon.png`);
		try {
			await rename(result.iconPath, target);
			iconPath = target;
		} catch (err) {
			log.warn("failed to rename capture icon, falling back to copy", err);
			try {
				await copyFile(result.iconPath, target);
				iconPath = target;
				await unlink(result.iconPath).catch(() => {});
			} catch (copyErr) {
				log.warn("failed to copy capture icon, keep original path", copyErr);
				iconPath = result.iconPath;
			}
		}
	}

	// 文本层只用辅助功能（AX）：抓到任何非空文本就落 md，抓不到就只带截图，
	// 由 agent 自行用视觉能力理解截图，不在捕获阶段做 OCR。
	const axText = typeof result.axText === "string" ? result.axText.trim() : "";
	const basePayload = { id, appName, windowTitle, documentPath, imagePath, iconPath, capturedAt };

	let textPath: string | null = null;
	if (axText) {
		textPath = join(dir, `${id}.md`);
		await writeFile(textPath, buildMarkdown(meta, axText), "utf8");
	}

	// 有截图、有文本、或有可用元信息（窗口标题/源文件路径）任一即算捕获成功。
	if (imagePath || textPath || documentPath || windowTitle) {
		emitCaptured({ ...basePayload, textPath });
		return;
	}

	sendCaptureError("helper-failed");
}

function emitCaptured(payload: AppshotCapturedPayload): void {
	// 播放 macOS 截图快门音效，fire-and-forget，不阻塞主流程
	if (process.platform === "darwin") {
		execFile("/usr/bin/afplay", [SCREENSHOT_SOUND], (err) => {
			if (err) log.debug("appshot sound playback failed", err.message);
		});
	}

	const win = showMainWindow();
	if (!win.isDestroyed()) {
		win.webContents.send(APPSHOT_CHANNELS.CAPTURED, payload);
	}
}
