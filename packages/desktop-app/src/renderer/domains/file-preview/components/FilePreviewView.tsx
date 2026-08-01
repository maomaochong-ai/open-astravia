import type { FilePreviewContext } from "@vetta/theme-ui/file-preview";
import { FilePreviewView as ThemeFilePreviewView } from "@vetta/theme-ui/file-preview";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useFilePreviewKeyboardScope } from "../hooks/useFilePreviewKeyboardScope";
import { downloadItem } from "../preview-utils";
import { PreviewBody } from "./PreviewContent";
import { PreviewErrorBoundary } from "./PreviewErrorBoundary";

interface FilePreviewViewProps {
	ctx: FilePreviewContext;
	onPrev?: () => void;
	onNext?: () => void;
	onClose: () => void;
	canPrev: boolean;
	canNext: boolean;
	/** Register surface-scope shortcuts (←→ Esc). Host should set true for activity panel. */
	enableKeyboard?: boolean;
	onToggleSidebar?: () => void;
	sidebarCollapsed?: boolean;
}

export function FilePreviewView({
	ctx,
	onPrev,
	onNext,
	onClose,
	canPrev,
	canNext,
	enableKeyboard = false,
	onToggleSidebar,
	sidebarCollapsed,
}: FilePreviewViewProps): JSX.Element | null {
	const { t } = useTranslation("chat");
	const item = ctx.items[ctx.index] ?? null;
	const canNavigate = ctx.items.length > 1;

	useFilePreviewKeyboardScope({
		active: enableKeyboard,
		item,
		canPrev: canNavigate && canPrev,
		canNext: canNavigate && canNext,
		onPrev: canNavigate ? onPrev : undefined,
		onNext: canNavigate ? onNext : undefined,
		onClose,
	});

	return (
		<ThemeFilePreviewView
			ctx={ctx}
			labels={{
				showTree: t("fileEditor.showTree"),
				hideTree: t("fileEditor.hideTree"),
				prev: t("fileEditor.previous"),
				next: t("fileEditor.next"),
				download: t("fileEditor.downloadShort"),
				refresh: t("fileEditor.refresh"),
				close: t("fileEditor.close"),
			}}
			onPrev={onPrev}
			onNext={onNext}
			onClose={onClose}
			canPrev={canPrev}
			canNext={canNext}
			onToggleSidebar={onToggleSidebar}
			sidebarCollapsed={sidebarCollapsed}
			onDownload={(previewItem) => void downloadItem(previewItem)}
			renderBody={(previewItem, refreshNonce) => (
				<PreviewErrorBoundary resetKey={previewItem}>
					<PreviewBody item={previewItem} refreshNonce={refreshNonce} editable />
				</PreviewErrorBoundary>
			)}
		/>
	);
}

/**
 * Hook 返回标准的 prev/next/close 导航回调，绑定到一个可写的预览上下文 atom。
 */
export function usePreviewNav(
	setCtx: (
		ctx:
			| FilePreviewContext
			| null
			| ((prev: FilePreviewContext | null) => FilePreviewContext | null),
	) => void,
): {
	goPrev: () => void;
	goNext: () => void;
	close: () => void;
} {
	const goPrev = useCallback(() => {
		setCtx((prev) => {
			if (!prev || prev.items.length <= 1) return prev;
			const next = prev.index - 1;
			return next < 0 ? prev : { ...prev, index: next };
		});
	}, [setCtx]);
	const goNext = useCallback(() => {
		setCtx((prev) => {
			if (!prev || prev.items.length <= 1) return prev;
			const next = prev.index + 1;
			return next >= prev.items.length ? prev : { ...prev, index: next };
		});
	}, [setCtx]);
	const close = useCallback(() => setCtx(null), [setCtx]);
	return { goPrev, goNext, close };
}
