import { recordInputFilesAdded } from "@shared/lib/app-monitor-events";
import { isImagePath } from "@shared/lib/input-tokens";
import { isSubPath, pathBasename } from "@shared/lib/utils";
import { activeSessionAtom, type MentionedFile, mentionedFilesAtom } from "@shared/store/atoms";
import type { SessionDropZoneViewProps } from "@vetta/theme-ui/chat";
import { useAtomValue } from "jotai";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { insertFileToken, insertImageToken } from "../components/input-bar/editor/inputEditorHandle";
import { persistImageFiles } from "../components/input-bar/editor/persistImages";

const VETTA_PATH_MIME = "application/vetta-path";
const VETTA_PATH_META_MIME = "application/vetta-path-meta";

type DragKind = "files" | "internal";

function detectKind(e: React.DragEvent): DragKind | null {
	const types = Array.from(e.dataTransfer.types);
	if (types.includes(VETTA_PATH_MIME)) return "internal";
	if (types.includes("Files")) return "files";
	return null;
}

export interface SessionDropZoneModel extends Omit<SessionDropZoneViewProps, "children"> {}

export function useSessionDropZoneModel(cwdOverride?: string): SessionDropZoneModel {
	const { t } = useTranslation("chat");
	const activeSession = useAtomValue(activeSessionAtom);
	const rootDirectory = cwdOverride ?? activeSession?.cwd ?? null;
	// 只读投影：用来跳过已经在输入框里的路径，避免重复插 token。
	const mentionedFiles = useAtomValue(mentionedFilesAtom);
	const [dragKind, setDragKind] = useState<DragKind | null>(null);
	const dragCounter = useRef(0);

	const enabled = Boolean(activeSession) || Boolean(cwdOverride);

	const handleDragEnter = useCallback(
		(e: React.DragEvent) => {
			const kind = detectKind(e);
			if (!kind || !enabled) return;
			e.preventDefault();
			e.stopPropagation();
			dragCounter.current += 1;
			setDragKind(kind);
		},
		[enabled],
	);

	const handleDragOver = useCallback(
		(e: React.DragEvent) => {
			const kind = detectKind(e);
			if (!kind || !enabled) return;
			e.preventDefault();
			e.stopPropagation();
			e.dataTransfer.dropEffect = "copy";
		},
		[enabled],
	);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		// Child chrome (buttons, tokens) fires leave; only clear when really outside.
		const related = e.relatedTarget;
		if (related instanceof Node && e.currentTarget.contains(related)) return;
		dragCounter.current = Math.max(0, dragCounter.current - 1);
		if (dragCounter.current === 0) setDragKind(null);
	}, []);

	const resetDrag = useCallback(() => {
		dragCounter.current = 0;
		setDragKind(null);
	}, []);

	/**
	 * 拖入的文件变成输入框里的行内 token。
	 * mentionedFiles 现在是编辑器投影，不能直接往里塞——插 token 后它自会更新。
	 */
	const pushMentioned = useCallback(
		(entries: MentionedFile[]) => {
			if (entries.length === 0) return;
			const seen = new Set(mentionedFiles.map((f) => f.path));
			const additions: MentionedFile[] = [];
			for (const ent of entries) {
				if (!ent.path || seen.has(ent.path)) continue;
				seen.add(ent.path);
				additions.push(ent);
				if (isImagePath(ent.path)) insertImageToken(ent.path);
				else insertFileToken(ent.path, ent.isDirectory);
			}
			if (additions.length === 0) return;
			recordInputFilesAdded("drop", additions);
		},
		[mentionedFiles],
	);

	const handleDrop = useCallback(
		async (e: React.DragEvent) => {
			const kind = detectKind(e);
			resetDrag();
			if (!kind || !enabled) return;
			e.preventDefault();
			e.stopPropagation();

			if (kind === "internal") {
				const path = e.dataTransfer.getData(VETTA_PATH_MIME);
				if (!path) return;
				let isDirectory = false;
				let name = pathBasename(path);
				const metaRaw = e.dataTransfer.getData(VETTA_PATH_META_MIME);
				if (metaRaw) {
					try {
						const meta = JSON.parse(metaRaw) as { isDirectory?: boolean; name?: string };
						if (typeof meta.isDirectory === "boolean") isDirectory = meta.isDirectory;
						if (typeof meta.name === "string" && meta.name) name = meta.name;
					} catch {
						// ignore malformed meta — fall back to defaults
					}
				}
				pushMentioned([{ path, name, isDirectory }]);
				return;
			}

			const items = Array.from(e.dataTransfer.items);
			const files = Array.from(e.dataTransfer.files);

			const imageFiles: File[] = [];
			const otherEntries: MentionedFile[] = [];

			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				if (!file) continue;
				const item = items[i];
				let isDirectory = false;
				if (item && typeof item.webkitGetAsEntry === "function") {
					const entry = item.webkitGetAsEntry();
					if (entry?.isDirectory) isDirectory = true;
				}
				if (!isDirectory && file.type === "" && file.size === 0) isDirectory = true;

				const path = window.vetta.fs.pathForFile(file);
				if (path && rootDirectory && isSubPath(path, rootDirectory)) {
					otherEntries.push({ path, name: file.name || pathBasename(path), isDirectory, sizeBytes: file.size });
					continue;
				}
				if (file.type.startsWith("image/")) {
					imageFiles.push(file);
					continue;
				}
				if (!path) continue;
				otherEntries.push({ path, name: file.name || pathBasename(path), isDirectory, sizeBytes: file.size });
			}

			if (imageFiles.length > 0) {
				// 先落盘拿到路径，才能插入行内缩略图 token。
				const paths = await persistImageFiles(imageFiles, activeSession?.runtimeId ?? null, "drop");
				for (const path of paths) insertImageToken(path);
			}
			pushMentioned(otherEntries);
		},
		[activeSession?.runtimeId, enabled, pushMentioned, resetDrag, rootDirectory],
	);

	return {
		dragKind,
		enabled,
		labels: {
			releaseToRef: t("dropZone.releaseToRef"),
			internalRef: t("dropZone.internalRef"),
			externalRef: t("dropZone.externalRef"),
		},
		onDragEnter: handleDragEnter,
		onDragOver: handleDragOver,
		onDragLeave: handleDragLeave,
		onDrop: (e) => void handleDrop(e),
	};
}
