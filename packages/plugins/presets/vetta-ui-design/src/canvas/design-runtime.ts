/**
 * Module-level runtime shared between the canvas UI and the agent tools
 * (vetd_screenshot / vetd_status need to reach the live canvas), plus the
 * "modifying" frame state fed by conversation tool events (index.tsx).
 */
import type { DesignSession } from "../vetd/design-session";

export type FrameActivity = "reading" | "modifying" | "creating" | "updated";

export interface CanvasController {
	session: DesignSession;
	port: number;
	captureFrame(frameId: string): Promise<string>;
	openDesign(vetdPath: string): void;
}

type ActivityListener = (activity: ReadonlyMap<string, FrameActivity>) => void;

let controller: CanvasController | null = null;
const activity = new Map<string, FrameActivity>();
const activityListeners = new Set<ActivityListener>();
/** 挂在某个 frame 上的待清理定时器：「已更新」的淡出，或活动态的最短停留。 */
const activityTimers = new Map<string, number>();
/** 进行中的工具调用 → 目标 frame：tool-call-end 只带 toolCallId，靠它找回目标。 */
const activeCalls = new Map<string, { frameId: string; kind: Exclude<FrameActivity, "updated">; startedAt: number }>();

export function setCanvasController(next: CanvasController | null): void {
	controller = next;
}

export function getCanvasController(): CanvasController | null {
	return controller;
}

/** Hand-off from tools (vetd_create) to the canvas: open this design when the tab mounts/refreshes. */
let pendingDesignPath: string | null = null;

export function setPendingDesignPath(vetdPath: string | null): void {
	pendingDesignPath = vetdPath;
}

export function takePendingDesignPath(): string | null {
	const value = pendingDesignPath;
	pendingDesignPath = null;
	return value;
}

/**
 * Bridge from the canvas (activity tab) to the export dialog (global slot).
 * Both live in the same Module Federation instance, so a module-level channel
 * is all it takes — the canvas keeps owning the frames and their capture path.
 */
export interface MockupExportRequest {
	session: DesignSession;
	/** Frames to render, already ordered left-to-right by canvas position. */
	frameIds: string[];
	capture(frameId: string, pixelRatio: number): Promise<string>;
}

type MockupListener = (request: MockupExportRequest | null) => void;

let mockupRequest: MockupExportRequest | null = null;
const mockupListeners = new Set<MockupListener>();

export function requestMockupExport(request: MockupExportRequest | null): void {
	mockupRequest = request;
	for (const listener of mockupListeners) listener(mockupRequest);
}

export function onMockupExport(listener: MockupListener): () => void {
	mockupListeners.add(listener);
	listener(mockupRequest);
	return () => mockupListeners.delete(listener);
}

export function onFrameActivity(listener: ActivityListener): () => void {
	activityListeners.add(listener);
	listener(activity);
	return () => activityListeners.delete(listener);
}

function emitActivity(): void {
	for (const listener of activityListeners) listener(activity);
}

function frameIdForPath(path: string): string | null {
	const session = controller?.session;
	if (!session) return null;
	const prefix = `${session.dirPath}/frames/`;
	if (!path.startsWith(prefix)) return null;
	const rest = path.slice(prefix.length);
	if (!rest.endsWith(".tsx") || rest.includes("/")) return null;
	return rest.replace(/\.tsx$/, "");
}

/** 工具调用常常不到 1 秒就返回，动画一闪而过；结束后至少挂满这么久再落定。 */
const MIN_ACTIVE_MS = 1_200;

/** 工具名 → 活动态。带 frame 路径但叫不出名字的工具按「修改中」兜底（与旧行为一致）。 */
const TOOL_ACTIVITY: Record<string, Exclude<FrameActivity, "updated">> = {
	read: "reading",
	edit: "modifying",
	write: "creating",
};

function clearTimer(frameId: string): void {
	const timer = activityTimers.get(frameId);
	if (timer !== undefined) {
		window.clearTimeout(timer);
		activityTimers.delete(frameId);
	}
}

/** tool-call-start with a file-path arg targeting a frame → 浏览中 / 修改中 / 创作中. */
export function notifyAgentToolStart(
	toolCallId: string,
	toolName: string,
	args: Record<string, unknown> | undefined,
): void {
	if (!args) return;
	const candidates = [args.file_path, args.path, args.filePath, args.notebook_path];
	for (const candidate of candidates) {
		if (typeof candidate !== "string") continue;
		const frameId = frameIdForPath(candidate);
		if (!frameId) continue;
		clearTimer(frameId);
		const kind = TOOL_ACTIVITY[toolName] ?? "modifying";
		activeCalls.set(toolCallId, { frameId, kind, startedAt: Date.now() });
		activity.set(frameId, kind);
		emitActivity();
	}
}

/**
 * 与工具调用实时同步：tool-call-end 一到就落定，不等 HMR——edit/write 返回时
 * 文件已写盘，vite 的热更新紧随其后，等它只是让状态多挂几秒。
 * 浏览没改过东西、出错的调用没改成东西，都无痕消失；修改/创作闪「已更新」。
 * HMR / turn-end 的 notifyFrameSettled 仍在，作为 end 事件丢失时的兜底。
 */
export function notifyAgentToolEnd(toolCallId: string, isError: boolean): void {
	const call = activeCalls.get(toolCallId);
	if (!call) return;
	activeCalls.delete(toolCallId);
	const { frameId, kind, startedAt } = call;
	if (activity.get(frameId) !== kind) return;
	const finish = (): void => {
		activityTimers.delete(frameId);
		if (activity.get(frameId) !== kind) return;
		if (kind === "reading" || isError) {
			activity.delete(frameId);
			emitActivity();
			return;
		}
		notifyFrameSettled(frameId);
	};
	const remaining = MIN_ACTIVE_MS - (Date.now() - startedAt);
	if (remaining <= 0) {
		finish();
		return;
	}
	clearTimer(frameId);
	activityTimers.set(frameId, window.setTimeout(finish, remaining));
}

/** HMR arrival or turn end → flash “已更新” then clear.（浏览态没改过东西，直接消失。） */
export function notifyFrameSettled(frameId: string | null): void {
	const ids = frameId ? [frameId] : [...activity.keys()];
	// 还有工具调用在途的 frame 不能被单帧 HMR 落定：那是上一次改动触发的热更新，
	// 这一次还没写完。turn-end 的全量清扫（frameId 为 null）不受此限——不会再有
	// end 事件来了，顺带把在途表也清掉，免得丢事件后越积越多。
	const busy = new Set([...activeCalls.values()].map((call) => call.frameId));
	if (frameId === null) activeCalls.clear();
	let changed = false;
	for (const id of ids) {
		if (frameId !== null && busy.has(id)) continue;
		const current = activity.get(id);
		if (current === undefined || current === "updated") continue;
		if (current === "reading") {
			// 单帧的 HMR 信号是别的改动触发的，正在看的这一眼不该被它打断。
			if (frameId !== null) continue;
			clearTimer(id);
			activity.delete(id);
			changed = true;
			continue;
		}
		clearTimer(id);
		activity.set(id, "updated");
		changed = true;
		const timer = window.setTimeout(() => {
			activityTimers.delete(id);
			if (activity.get(id) === "updated") {
				activity.delete(id);
				emitActivity();
			}
		}, 2_000);
		activityTimers.set(id, timer);
	}
	if (changed) emitActivity();
}

/**
 * frameId → 编译/渲染错误。放在模块级而不是画布 state 里：agent 工具（vetd_screenshot）
 * 要在截图前就知道这一帧是坏的，否则只能发出一条没人应答的截图请求、干等到超时。
 */
const frameErrors = new Map<string, string>();
type FrameErrorListener = (errors: ReadonlyMap<string, string>) => void;
const frameErrorListeners = new Set<FrameErrorListener>();

export function onFrameErrors(listener: FrameErrorListener): () => void {
	frameErrorListeners.add(listener);
	listener(frameErrors);
	return () => frameErrorListeners.delete(listener);
}

export function getFrameError(frameId: string): string | null {
	return frameErrors.get(frameId) ?? null;
}

/** `message` 为 null 表示这一帧恢复正常。 */
export function setFrameError(frameId: string, message: string | null): void {
	if ((frameErrors.get(frameId) ?? null) === message) return;
	if (message) frameErrors.set(frameId, message);
	else frameErrors.delete(frameId);
	// 构建失败的 frame 等不到 HMR，「修改中」会一直挂着；错误徽标接管，直接收掉。
	// 也不翻成「已更新」——这一轮改动根本没生效。
	if (message && activity.has(frameId)) {
		clearTimer(frameId);
		activity.delete(frameId);
		emitActivity();
	}
	for (const listener of frameErrorListeners) listener(frameErrors);
}

export function clearFrameErrors(): void {
	if (frameErrors.size === 0) return;
	frameErrors.clear();
	for (const listener of frameErrorListeners) listener(frameErrors);
}

export function clearFrameActivity(): void {
	activity.clear();
	activeCalls.clear();
	for (const timer of activityTimers.values()) window.clearTimeout(timer);
	activityTimers.clear();
	emitActivity();
}
