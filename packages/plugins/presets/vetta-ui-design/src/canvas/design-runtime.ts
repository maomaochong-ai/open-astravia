/**
 * Module-level runtime shared between the canvas UI and the agent tools
 * (vetd_screenshot / vetd_status need to reach the live canvas), plus the
 * "modifying" frame state fed by conversation tool events (index.tsx).
 */
import type { DesignSession } from "../vetd/design-session";

export type FrameActivity = "modifying" | "updated";

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
const updatedTimers = new Map<string, number>();

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

/** tool-call-start with a file-path arg targeting a frame → “修改中”. */
export function notifyAgentToolStart(args: Record<string, unknown> | undefined): void {
	if (!args) return;
	const candidates = [args.file_path, args.path, args.filePath, args.notebook_path];
	for (const candidate of candidates) {
		if (typeof candidate !== "string") continue;
		const frameId = frameIdForPath(candidate);
		if (!frameId) continue;
		const timer = updatedTimers.get(frameId);
		if (timer !== undefined) {
			window.clearTimeout(timer);
			updatedTimers.delete(frameId);
		}
		activity.set(frameId, "modifying");
		emitActivity();
	}
}

/** HMR arrival or turn end → flash “已更新” then clear. */
export function notifyFrameSettled(frameId: string | null): void {
	const ids = frameId ? [frameId] : [...activity.keys()];
	let changed = false;
	for (const id of ids) {
		if (activity.get(id) !== "modifying") continue;
		activity.set(id, "updated");
		changed = true;
		const timer = window.setTimeout(() => {
			updatedTimers.delete(id);
			if (activity.get(id) === "updated") {
				activity.delete(id);
				emitActivity();
			}
		}, 2_000);
		updatedTimers.set(id, timer);
	}
	if (changed) emitActivity();
}

export function clearFrameActivity(): void {
	activity.clear();
	for (const timer of updatedTimers.values()) window.clearTimeout(timer);
	updatedTimers.clear();
	emitActivity();
}
