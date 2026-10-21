import type { SessionDropZoneViewProps } from "@astravia-org/theme-ui/chat";
import { recordInputFilesAdded } from "@shared/lib/app-monitor-events";
import { isImagePath } from "@shared/lib/input-tokens";
import { isSubPath, pathBasename } from "@shared/lib/utils";
import { activeSessionAtom, type MentionedFile, mentionedFilesAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { insertFileTokens, insertImageToken } from "../components/input-bar/editor/inputEditorHandle";
import { persistImageFiles } from "../components/input-bar/editor/persistImages";
import {
	ASTRAVIA_PATH_MIME,
	type DropDragKind,
	detectDropKind,
	parseFileUriList,
	readDropSnapshot,
} from "../drop-payload";

const ASTRAVIA_PATH_META_MIME = "application/astravia-path-meta";

export interface SessionDropZoneModel extends Omit<SessionDropZoneViewProps, "children"> {}

export function useSessionDropZoneModel(cwdOverride?: string): SessionDropZoneModel {
	const { t } = useTranslation("chat");
	const activeSession = useAtomValue(activeSessionAtom);
	const rootDirectory = cwdOverride ?? activeSession?.cwd ?? null;
	// 只读投影：用来跳过已经在输入框里的路径，避免重复插 token。
	const mentionedFiles = useAtomValue(mentionedFilesAtom);
	const [dragKind, setDragKind] = useState<DropDragKind | null>(null);

	const enabled = Boolean(activeSession) || Boolean(cwdOverride);

	const handleDragEnter = useCallback(
		(e: React.DragEvent) => {
			const kind = detectDropKind(readDropSnapshot(e));
			if (!kind || !enabled) return;
			e.preventDefault();
			e.stopPropagation();
			// Child enter events bubble; just keep/refresh highlight (no enter counter).
			setDragKind(kind);
		},
		[enabled],
	);

	const handleDragOver = useCallback(
		(e: React.DragEvent) => {
			const kind = detectDropKind(readDropSnapshot(e));
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
		// Only clear when the pointer actually leaves the drop zone (not when
		// moving between children). Do not mix this with enter/leave counters —
		// bubbled child enters would desync the counter and leave the overlay stuck on.
		const related = e.relatedTarget;
		if (related instanceof Node && e.currentTarget.contains(related)) return;
		setDragKind(null);
	}, []);

	const resetDrag = useCallback(() => {
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
			const fileTokens: { path: string; isDirectory: boolean }[] = [];
			const imagePaths: string[] = [];
			for (const ent of entries) {
				if (!ent.path || seen.has(ent.path)) continue;
				seen.add(ent.path);
				additions.push(ent);
				if (isImagePath(ent.path)) imagePaths.push(ent.path);
				else fileTokens.push({ path: ent.path, isDirectory: ent.isDirectory });
			}
			if (additions.length === 0) return;
			// 文件 token 合并成一次编辑器更新：拖几十个文件时逐个插会卡住输入框。
			insertFileTokens(fileTokens);
			for (const path of imagePaths) insertImageToken(path);
			recordInputFilesAdded("drop", additions);
		},
		[mentionedFiles],
	);

	const handleDrop = useCallback(
		async (e: React.DragEvent) => {
			// 先无条件拦住：dragover 没被 preventDefault 时浏览器根本不会派发 drop，
			// 能走到这里的都是已被放行的文件类拖拽。拦晚了编辑器会把路径当纯文本插进来。
			if (enabled) {
				e.preventDefault();
				e.stopPropagation();
			}
			const kind = detectDropKind(readDropSnapshot(e));
			resetDrag();
			if (!kind || !enabled) return;

			if (kind === "internal") {
				const path = e.dataTransfer.getData(ASTRAVIA_PATH_MIME);
				if (!path) return;
				let isDirectory = false;
				let name = pathBasename(path);
				const metaRaw = e.dataTransfer.getData(ASTRAVIA_PATH_META_MIME);
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

			// Windows 原生拖拽拿不到 File 对象时退回 URI 列表，否则整次拖拽会被丢掉。
			if (files.length === 0) {
				const uriPaths = parseFileUriList(e.dataTransfer.getData("text/uri-list"));
				if (uriPaths.length > 0) {
					pushMentioned(uriPaths.map((path) => ({ path, name: pathBasename(path), isDirectory: false })));
				}
				return;
			}

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

				const path = window.astravia.fs.pathForFile(file);
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
