import type { PluginFsApi } from "@vetta-org/plugin-sdk";
import type { SourceIssue } from "./check-sources";
import { collectSources } from "./inspect";

const MAX_BATCH_FRAMES = 12;
const SHEET_MAX_EDGE = 3_000;
const SHEET_COLUMNS = 3;
const SHEET_GAP = 20;
const SHEET_PADDING = 24;
const SHEET_LABEL_HEIGHT = 34;

export interface ScreenshotSelectionInput {
	frame?: string;
	frames?: string[];
	all?: boolean;
}

export interface ScreenshotSelection {
	frameIds: string[];
	single: boolean;
}

/**
 * 单帧参数保持兼容，同时让多屏设计用一次工具调用完成捕获。
 * 三种选择方式互斥，避免 `frame` 与 `all` 同时出现时悄悄扩大验证范围。
 */
export function resolveScreenshotSelection(
	input: ScreenshotSelectionInput,
	knownFrameIds: readonly string[],
): ScreenshotSelection {
	const modes = Number(typeof input.frame === "string") + Number(Array.isArray(input.frames)) + Number(input.all === true);
	if (modes !== 1) {
		throw new Error("Pass exactly one of `frame`, `frames`, or `all: true`.");
	}
	const requested = input.all === true ? [...knownFrameIds] : Array.isArray(input.frames) ? input.frames : [input.frame ?? ""];
	const frameIds = [...new Set(requested.map((id) => id.trim().replace(/\.tsx$/, "")).filter(Boolean))];
	if (frameIds.length === 0) throw new Error("No frames were selected for capture.");
	if (frameIds.length > MAX_BATCH_FRAMES) {
		throw new Error(`A screenshot batch is limited to ${MAX_BATCH_FRAMES} frames; split this selection into smaller batches.`);
	}
	return { frameIds, single: typeof input.frame === "string" && frameIds.length === 1 };
}

/** 小而稳定的非密码学指纹；只用于判断两次本地验证输入是否相同。 */
export function verificationHash(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * 逐帧计算验证输入：改某个页面只让它自己的截图过期；改共享 layout、component、主题
 * 或依赖则让所有使用同一运行环境的页面过期。比整份设计一个总指纹少很多无效复验。
 */
export async function designSourceFingerprints(
	fs: PluginFsApi,
	dirPath: string,
	frameIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
	const sources = await collectSources(fs, dirPath);
	const extras = await Promise.all(
		["theme.css", "package.json"].map(async (path) => {
			const content = await fs.readFile(`${dirPath}/${path}`).then((result) => result.content, () => "<missing>");
			return { path, content };
		}),
	);
	const shared = [
		...sources.filter((source) => source.path === "frames/_layout.tsx" || source.path.startsWith("components/")),
		...extras,
	];
	return new Map(
		frameIds.map((frameId) => {
			const own = sources.find((source) => source.path === `frames/${frameId}.tsx`) ?? {
				path: `frames/${frameId}.tsx`,
				content: "<missing>",
			};
			const fingerprint = verificationHash(
				[...shared, own]
					.sort((a, b) => a.path.localeCompare(b.path))
					.map((source) => `${source.path}\0${source.content}`)
					.join("\0\0"),
			);
			return [frameId, fingerprint];
		}),
	);
}

interface CaptureRecord {
	imageFingerprint: string;
	issueFingerprint: string;
	issueCount: number;
	repeatedIssueCount: number;
	sourceFingerprint: string;
	capturedAt: number;
}

export interface CaptureObservation {
	imageUnchanged: boolean;
	repeatedIssueCount: number;
	/** 连续两次画面和 issues 都相同：继续做第三轮盲改没有信息增益。 */
	stalled: boolean;
}

const captureRecords = new Map<string, CaptureRecord>();

function captureKey(vetdPath: string, frameId: string): string {
	return `${vetdPath}\0${frameId}`;
}

function issuesFingerprint(issues: readonly SourceIssue[]): string {
	return verificationHash(
		issues
			.map((issue) => `${issue.file}:${issue.line ?? ""}:${issue.rule}:${issue.message}`)
			.sort()
			.join("\n"),
	);
}

export function recordVerificationCapture(input: {
	vetdPath: string;
	frameId: string;
	dataUrl: string;
	issues: readonly SourceIssue[];
	sourceFingerprint: string;
	capturedAt: number;
}): CaptureObservation {
	const key = captureKey(input.vetdPath, input.frameId);
	const previous = captureRecords.get(key);
	const imageFingerprint = verificationHash(input.dataUrl);
	const issueFingerprint = issuesFingerprint(input.issues);
	const imageUnchanged = previous?.imageFingerprint === imageFingerprint;
	const repeatedIssueCount =
		input.issues.length > 0 && previous?.issueFingerprint === issueFingerprint
			? previous.repeatedIssueCount + 1
			: input.issues.length > 0
				? 1
				: 0;
	const stalled = imageUnchanged && repeatedIssueCount >= 2;
	captureRecords.set(key, {
		imageFingerprint,
		issueFingerprint,
		issueCount: input.issues.length,
		repeatedIssueCount,
		sourceFingerprint: input.sourceFingerprint,
		capturedAt: input.capturedAt,
	});
	return { imageUnchanged, repeatedIssueCount, stalled };
}

export interface RenderVerificationSummary {
	status: "not-run" | "stale" | "issues" | "partial" | "clean";
	verifiedFrames: string[];
	unverifiedFrames: string[];
	staleFrames: string[];
	issueFrames: { frame: string; issues: number; repeated: number }[];
}

export function summarizeRenderVerification(
	vetdPath: string,
	frameIds: readonly string[],
	sourceFingerprints: ReadonlyMap<string, string>,
): RenderVerificationSummary {
	const verifiedFrames: string[] = [];
	const unverifiedFrames: string[] = [];
	const staleFrames: string[] = [];
	const issueFrames: { frame: string; issues: number; repeated: number }[] = [];
	for (const frameId of frameIds) {
		const record = captureRecords.get(captureKey(vetdPath, frameId));
		if (!record) {
			unverifiedFrames.push(frameId);
			continue;
		}
		if (record.sourceFingerprint !== sourceFingerprints.get(frameId)) {
			staleFrames.push(frameId);
			continue;
		}
		verifiedFrames.push(frameId);
		if (record.issueCount > 0) {
			issueFrames.push({ frame: frameId, issues: record.issueCount, repeated: record.repeatedIssueCount });
		}
	}
	const anyRecord = frameIds.some((frameId) => captureRecords.has(captureKey(vetdPath, frameId)));
	const status: RenderVerificationSummary["status"] = !anyRecord
		? "not-run"
		: staleFrames.length > 0
			? "stale"
			: issueFrames.length > 0
				? "issues"
				: unverifiedFrames.length > 0
					? "partial"
					: "clean";
	return { status, verifiedFrames, unverifiedFrames, staleFrames, issueFrames };
}

/** 仅供测试和插件生命周期重置使用。 */
export function resetRenderVerificationState(): void {
	captureRecords.clear();
}

export interface VerificationSheetPiece {
	id: string;
	width: number;
	height: number;
	x: number;
	y: number;
}

export interface VerificationSheetPlan {
	width: number;
	height: number;
	scale: number;
	pieces: VerificationSheetPiece[];
}

/** 把多帧排成至多三列的等单元格总览，并整体缩到合理长边，避免生成巨图。 */
export function planVerificationSheet(
	frames: readonly { id: string; width: number; height: number }[],
	maxEdge = SHEET_MAX_EDGE,
): VerificationSheetPlan | null {
	if (frames.length === 0) return null;
	const valid = frames.filter((frame) => frame.width > 0 && frame.height > 0);
	if (valid.length === 0) return null;
	const columns = Math.min(SHEET_COLUMNS, Math.ceil(Math.sqrt(valid.length)));
	const rows = Math.ceil(valid.length / columns);
	const cellWidth = Math.max(...valid.map((frame) => frame.width));
	const cellHeight = Math.max(...valid.map((frame) => frame.height)) + SHEET_LABEL_HEIGHT;
	const rawWidth = SHEET_PADDING * 2 + columns * cellWidth + (columns - 1) * SHEET_GAP;
	const rawHeight = SHEET_PADDING * 2 + rows * cellHeight + (rows - 1) * SHEET_GAP;
	const scale = Math.min(1, maxEdge / Math.max(rawWidth, rawHeight));
	const pieces = valid.map((frame, index) => ({
		...frame,
		x: SHEET_PADDING + (index % columns) * (cellWidth + SHEET_GAP) + (cellWidth - frame.width) / 2,
		y: SHEET_PADDING + Math.floor(index / columns) * (cellHeight + SHEET_GAP) + SHEET_LABEL_HEIGHT,
	}));
	return {
		width: Math.max(1, Math.round(rawWidth * scale)),
		height: Math.max(1, Math.round(rawHeight * scale)),
		scale,
		pieces,
	};
}

function loadImage(dataUrl: string): Promise<HTMLImageElement | null> {
	return new Promise((resolve) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => resolve(null);
		image.src = dataUrl;
	});
}

/** 一张总览图替代 N 次 Read；合成失败时调用方仍可返回每张原图路径。 */
export async function composeVerificationSheet(
	frames: readonly { id: string; width: number; height: number; dataUrl: string }[],
): Promise<string | null> {
	if (typeof document === "undefined" || typeof Image === "undefined") return null;
	const loaded = await Promise.all(frames.map(async (frame) => ({ frame, image: await loadImage(frame.dataUrl) })));
	const available = loaded.filter((entry): entry is { frame: (typeof frames)[number]; image: HTMLImageElement } => Boolean(entry.image));
	const plan = planVerificationSheet(available.map((entry) => entry.frame));
	if (!plan) return null;
	const canvas = document.createElement("canvas");
	canvas.width = plan.width;
	canvas.height = plan.height;
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.scale(plan.scale, plan.scale);
	context.fillStyle = "#e8edf3";
	context.fillRect(0, 0, plan.width / plan.scale, plan.height / plan.scale);
	context.font = "600 18px system-ui, sans-serif";
	context.textBaseline = "middle";
	for (const piece of plan.pieces) {
		const entry = available.find((candidate) => candidate.frame.id === piece.id);
		if (!entry) continue;
		context.fillStyle = "#172033";
		context.fillText(piece.id, piece.x, piece.y - SHEET_LABEL_HEIGHT / 2);
		context.fillStyle = "#ffffff";
		context.fillRect(piece.x, piece.y, piece.width, piece.height);
		context.drawImage(entry.image, piece.x, piece.y, piece.width, piece.height);
		context.strokeStyle = "rgba(23, 32, 51, 0.2)";
		context.strokeRect(piece.x, piece.y, piece.width, piece.height);
	}
	try {
		return canvas.toDataURL("image/jpeg", 0.88);
	} catch {
		return null;
	}
}
