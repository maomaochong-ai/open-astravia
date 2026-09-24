import { usePreviewNav } from "@domains/file-preview/components/FilePreviewView";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import {
	activityPanelPreviewAvailableAtom,
	closeInlineFilePreviewAtom,
	type FilePreviewContext,
	inlineFilePreviewAtom,
	inlineFilePreviewContextReadonlyAtom,
} from "@shared/store/atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";

const TREE_DEFAULT_WIDTH = 220;
const TREE_MIN_WIDTH = 160;
const TREE_MAX_WIDTH = 360;

/** 当前挂载中的文件 tab 数；内嵌预览是全局的，只有全部离场才收起。 */
let mountedFileTabs = 0;

export interface FileTabContentModel {
	showTree: boolean;
	showPreview: boolean;
	treeWidth: number;
	treeCollapsed: boolean;
	previewMounted: boolean;
	previewCtx: FilePreviewContext | null;
	canPrev: boolean;
	canNext: boolean;
	onTreeResize: (delta: number) => void;
	toggleTree: () => void;
	goPrev: () => void;
	goNext: () => void;
	closePreview: () => void;
}

export function useFileTabContentModel(): FileTabContentModel {
	const [previewCtx, setPreviewCtx] = useAtom(inlineFilePreviewContextReadonlyAtom);
	const setPreview = useSetAtom(inlineFilePreviewAtom);
	const closePreview = useSetAtom(closeInlineFilePreviewAtom);
	const previewAvailable = useAtomValue(activityPanelPreviewAvailableAtom);
	const { goPrev, goNext } = usePreviewNav((updater) => {
		if (typeof updater === "function") {
			setPreviewCtx(updater(previewCtx));
		} else {
			setPreview(updater);
		}
	});
	const onClosePreview = useCallback(() => closePreview(), [closePreview]);

	const showPreview = previewCtx !== null && previewAvailable;
	const [previewMounted, setPreviewMounted] = useState(false);
	useEffect(() => {
		if (!showPreview) {
			setPreviewMounted(false);
			return;
		}
		let cancelled = false;
		void waitForCommittedPaint().then(() => {
			if (!cancelled) setPreviewMounted(true);
		});
		return () => {
			cancelled = true;
		};
	}, [showPreview]);

	const [treeWidth, setTreeWidth] = useState(TREE_DEFAULT_WIDTH);
	const onTreeResize = useCallback((delta: number) => {
		setTreeWidth((currentWidth) => Math.max(TREE_MIN_WIDTH, Math.min(TREE_MAX_WIDTH, currentWidth + delta)));
	}, []);

	const [treeCollapsed, setTreeCollapsed] = useState(false);
	const toggleTree = useCallback(() => setTreeCollapsed((collapsed) => !collapsed), []);
	useEffect(() => {
		if (!showPreview) setTreeCollapsed(false);
	}, [showPreview]);

	// 文件 tab 离场时收起预览。不能在卸载清理里直接关：从关闭态点开聊天里的文件时，预览
	// 在 tab 挂载前就已写入，挂载后若紧接一次卸载再挂载（StrictMode 的双调用、面板子树重挂），
	// 同步关闭会把刚写入的预览清掉，只剩目录树。推迟到微任务，届时仍无文件 tab 在场才关。
	useEffect(() => {
		mountedFileTabs += 1;
		return () => {
			mountedFileTabs -= 1;
			queueMicrotask(() => {
				if (mountedFileTabs === 0) closePreview();
			});
		};
	}, [closePreview]);

	return {
		showTree: !showPreview || !treeCollapsed,
		showPreview,
		treeWidth,
		treeCollapsed,
		previewMounted,
		previewCtx,
		canPrev: previewCtx !== null && previewCtx.index > 0,
		canNext: previewCtx !== null && previewCtx.index < previewCtx.items.length - 1,
		onTreeResize,
		toggleTree,
		goPrev,
		goNext,
		closePreview: onClosePreview,
	};
}
