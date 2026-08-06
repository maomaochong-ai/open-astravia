import { useTranslation } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import type { VetdFrameEntry } from "../vetd/manifest-types";
import { VIEWPORT_PRESETS, type ViewportSize } from "./viewport";

interface PreviewToolbarProps {
	frames: readonly VetdFrameEntry[];
	/** 当前地址对应的 frame；地址不在画框表里时为 null（帧选择器显示空）。 */
	currentFrameId: string | null;
	path: string;
	canBack: boolean;
	canForward: boolean;
	viewport: ViewportSize;
	onBack(): void;
	onForward(): void;
	onReload(): void;
	onPickFrame(frameId: string): void;
	onPickViewport(size: ViewportSize): void;
	/** 回到当前画框的声明尺寸。 */
	onResetViewport(): void;
	onOpenExternal(): void;
	onClose(): void;
}

const icons = {
	back: <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />,
	forward: <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />,
	reload: <path d="M20 11a8 8 0 10-2.3 5.7M20 5v6h-6" strokeLinecap="round" strokeLinejoin="round" />,
	external: (
		<>
			<path d="M14 4h6v6" strokeLinecap="round" strokeLinejoin="round" />
			<path d="M20 4l-9 9" strokeLinecap="round" />
			<path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" strokeLinecap="round" strokeLinejoin="round" />
		</>
	),
	close: <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />,
};

function IconButton({
	label,
	disabled,
	onClick,
	children,
}: {
	label: string;
	disabled?: boolean;
	onClick(): void;
	children: JSX.Element;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
			className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
		>
			<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
				{children}
			</svg>
		</button>
	);
}

/** 预览窗口顶部那条浏览器工具栏。纯展示，所有状态由 {@link PreviewDialog} 持有。 */
export function PreviewToolbar({
	frames,
	currentFrameId,
	path,
	canBack,
	canForward,
	viewport,
	onBack,
	onForward,
	onReload,
	onPickFrame,
	onPickViewport,
	onResetViewport,
	onOpenExternal,
	onClose,
}: PreviewToolbarProps) {
	const { t } = useTranslation();
	const presetId =
		VIEWPORT_PRESETS.find((preset) => preset.width === viewport.width && preset.height === viewport.height)?.id ?? "";
	return (
		<div className="flex items-center gap-1 border-b border-border bg-card px-2 py-1.5">
			<IconButton label={t("previewMode.back")} disabled={!canBack} onClick={onBack}>
				{icons.back}
			</IconButton>
			<IconButton label={t("previewMode.forward")} disabled={!canForward} onClick={onForward}>
				{icons.forward}
			</IconButton>
			<IconButton label={t("previewMode.reload")} onClick={onReload}>
				{icons.reload}
			</IconButton>
			{/* 地址栏：只读。设计稿的地址由画框文件名决定，能改的只有画框本身。 */}
			<div className="mx-1 min-w-0 flex-1 truncate rounded-lg bg-muted px-2.5 py-1 text-xs text-muted-foreground">
				{path}
			</div>
			<select
				value={currentFrameId ?? ""}
				onChange={(event) => onPickFrame(event.target.value)}
				title={t("previewMode.frame")}
				aria-label={t("previewMode.frame")}
				className="max-w-32 shrink-0 truncate rounded-lg border-none bg-muted px-1.5 py-1 text-xs text-foreground outline-none focus:outline-none"
			>
				{currentFrameId === null ? <option value="">—</option> : null}
				{frames.map((frame) => (
					<option key={frame.id} value={frame.id}>
						{frame.title || frame.id}
					</option>
				))}
			</select>
			<select
				value={presetId}
				onChange={(event) => {
					const preset = VIEWPORT_PRESETS.find((entry) => entry.id === event.target.value);
					if (preset) onPickViewport({ width: preset.width, height: preset.height });
					else onResetViewport();
				}}
				title={t("previewMode.viewport")}
				aria-label={t("previewMode.viewport")}
				className="shrink-0 rounded-lg border-none bg-muted px-1.5 py-1 text-xs text-foreground outline-none focus:outline-none"
			>
				{/* 尺寸被手动拉伸过时不匹配任何预设，用当前像素值占位。 */}
				<option value="">
					{presetId === "" ? `${Math.round(viewport.width)}×${Math.round(viewport.height)}` : t("previewMode.viewport.frame")}
				</option>
				{VIEWPORT_PRESETS.map((preset) => (
					<option key={preset.id} value={preset.id}>
						{t(preset.labelKey)} {preset.width}×{preset.height}
					</option>
				))}
			</select>
			<IconButton label={t("previewMode.openExternal")} onClick={onOpenExternal}>
				{icons.external}
			</IconButton>
			<div className="mx-0.5 h-5 w-px bg-border" />
			<IconButton label={t("previewMode.close")} onClick={onClose}>
				{icons.close}
			</IconButton>
		</div>
	);
}
