import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { type IpcMainEvent, ipcMain, nativeImage } from "electron";
import type {
	FileTransferAction,
	FileTransferConflictPolicy,
	FileTransferPlan,
	FileTransferResult,
} from "../../preload/fs-types.js";
import { inspectFilesystemTransfer, transferFilesystemEntries } from "../filesystem/file-transfer-service.js";
import { assertFilesystemPathWithinProject } from "../filesystem/filesystem-service.js";
import { createNativeDragFilePayload } from "../filesystem/native-file-drag.js";
import { getAppLogger } from "../logger.js";
import { iconPath } from "../window-manager.js";

const log = getAppLogger("file-transfer-ipc");
const PLAN_TTL_MS = 2 * 60 * 1000;
const MAX_TRANSFER_ITEMS = 100;

const CHANNELS = {
	PREPARE_DROP: "vetta:file-transfer:prepare-drop",
	COMMIT_DROP: "vetta:file-transfer:commit-drop",
	CANCEL_DROP: "vetta:file-transfer:cancel-drop",
	START_DRAG: "vetta:file-transfer:start-drag",
} as const;

interface StoredTransferPlan {
	ownerId: number;
	sourcePaths: string[];
	destinationDirectory: string;
	expiresAt: number;
}

function assertStringArray(value: unknown, fieldName: string): asserts value is string[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TRANSFER_ITEMS) {
		throw new Error(`Invalid ${fieldName}`);
	}
	for (const item of value) {
		if (typeof item !== "string" || !item.trim() || !isAbsolute(item)) {
			throw new Error(`Invalid ${fieldName}`);
		}
	}
}

function assertAction(value: unknown): asserts value is FileTransferAction {
	if (value !== "copy" && value !== "move") throw new Error("Invalid transfer action");
}

function assertConflictPolicy(value: unknown): asserts value is FileTransferConflictPolicy {
	if (value !== "keep-both" && value !== "replace" && value !== "skip") {
		throw new Error("Invalid conflict policy");
	}
}

export function registerFileTransferIpc(): () => void {
	const plans = new Map<string, StoredTransferPlan>();

	function pruneExpiredPlans(): void {
		const now = Date.now();
		for (const [id, plan] of plans) {
			if (plan.expiresAt <= now) plans.delete(id);
		}
	}

	ipcMain.handle(
		CHANNELS.PREPARE_DROP,
		async (event, sourcePaths: unknown, destinationDirectory: unknown): Promise<FileTransferPlan> => {
			assertStringArray(sourcePaths, "sourcePaths");
			if (typeof destinationDirectory !== "string" || !destinationDirectory.trim()) {
				throw new Error("Invalid destinationDirectory");
			}
			pruneExpiredPlans();
			const resolvedSources = [...new Set(sourcePaths.map((path) => resolve(path)))];
			const resolvedDestination = resolve(destinationDirectory);
			const items = await inspectFilesystemTransfer(resolvedSources, resolvedDestination);
			const id = randomUUID();
			plans.set(id, {
				ownerId: event.sender.id,
				sourcePaths: resolvedSources,
				destinationDirectory: resolvedDestination,
				expiresAt: Date.now() + PLAN_TTL_MS,
			});
			return { id, destinationDirectory: resolvedDestination, items };
		},
	);

	ipcMain.handle(
		CHANNELS.COMMIT_DROP,
		async (event, planId: unknown, action: unknown, conflictPolicy: unknown): Promise<FileTransferResult> => {
			if (typeof planId !== "string" || !planId) throw new Error("Invalid planId");
			assertAction(action);
			assertConflictPolicy(conflictPolicy);
			pruneExpiredPlans();
			const plan = plans.get(planId);
			if (!plan || plan.ownerId !== event.sender.id) throw new Error("Transfer plan expired or unavailable");
			plans.delete(planId);
			return transferFilesystemEntries({
				sourcePaths: plan.sourcePaths,
				destinationDirectory: plan.destinationDirectory,
				action,
				conflictPolicy,
			});
		},
	);

	ipcMain.handle(CHANNELS.CANCEL_DROP, (event, planId: unknown): void => {
		if (typeof planId !== "string" || !planId) return;
		const plan = plans.get(planId);
		if (plan?.ownerId === event.sender.id) plans.delete(planId);
	});

	const handleStartDrag = (event: IpcMainEvent, rawPaths: unknown): void => {
		try {
			assertStringArray(rawPaths, "paths");
			const paths = [...new Set(rawPaths.map((path) => resolve(path)))];
			for (const path of paths) {
				assertFilesystemPathWithinProject(path);
				if (!existsSync(path)) throw new Error("Drag source does not exist");
			}
			const icon = nativeImage.createFromPath(iconPath.linux ?? "").resize({ width: 32, height: 32 });
			if (icon.isEmpty()) throw new Error("Native drag icon could not be loaded");
			const payload = createNativeDragFilePayload(paths);
			log.info("starting native drag", { itemCount: paths.length, platform: process.platform });
			event.sender.startDrag({ ...payload, icon });
		} catch (error) {
			log.warn("native drag failed", error);
		}
	};
	ipcMain.on(CHANNELS.START_DRAG, handleStartDrag);

	return () => {
		plans.clear();
		ipcMain.removeHandler(CHANNELS.PREPARE_DROP);
		ipcMain.removeHandler(CHANNELS.COMMIT_DROP);
		ipcMain.removeHandler(CHANNELS.CANCEL_DROP);
		ipcMain.removeListener(CHANNELS.START_DRAG, handleStartDrag);
	};
}
