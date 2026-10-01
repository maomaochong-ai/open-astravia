import { useTranslation } from "@astravia-org/plugin-sdk";

export interface RailFrame {
	id: string;
	title: string;
	width: number;
	height: number;
	/** 画布留下的缓存位图；没有就出占位块，不为了缩略图再截一次。 */
	thumbnail: string | null;
}

interface FrameRailProps {
	frames: RailFrame[];
	/** 是否还有画框可加（全空时区分「设计稿没有画框」和「都加进去了」）。 */
	total: number;
	onAttach(frameId: string): void;
	onAttachAll(): void;
	onDragStart(frameId: string): void;
	onDragEnd(): void;
}

/**
 * 左侧竖排缩略图：还没进渲染区的画框。点一下加入，也可以直接拖进渲染区。
 * 加入后这里就不再出现它——列表是「已加入」的补集，见 attach.ts。
 */
export function FrameRail({ frames, total, onAttach, onAttachAll, onDragStart, onDragEnd }: FrameRailProps) {
	const { t } = useTranslation();
	return (
		<div
			className="flex w-32 shrink-0 flex-col border-r border-border bg-card/60"
			// 列表在预览区旁边，指针事件不能漏到平移手势上。
			onPointerDown={(event) => event.stopPropagation()}
		>
			<div className="flex items-center justify-between gap-1 px-2 py-2">
				<span className="text-[11px] font-medium text-muted-foreground">{t("mockup.rail.title")}</span>
				{frames.length > 0 ? (
					<button
						type="button"
						onClick={onAttachAll}
						className="rounded-md px-1.5 py-0.5 text-[11px] text-primary hover:bg-accent"
					>
						{t("mockup.rail.addAll")}
					</button>
				) : null}
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3">
				{frames.length === 0 ? (
					<p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
						{total === 0 ? t("mockup.rail.noFrames") : t("mockup.rail.allAdded")}
					</p>
				) : null}
				{frames.map((frame) => (
					<button
						key={frame.id}
						type="button"
						draggable
						onDragStart={() => onDragStart(frame.id)}
						onDragEnd={onDragEnd}
						onClick={() => onAttach(frame.id)}
						title={frame.title}
						className="group flex cursor-grab flex-col gap-1 rounded-lg border border-border bg-background p-1 text-left transition-colors hover:border-primary"
					>
						<span
							className="flex w-full items-center justify-center overflow-hidden rounded-md bg-muted"
							style={{ aspectRatio: `${Math.max(1, frame.width)} / ${Math.max(1, frame.height)}` }}
						>
							{frame.thumbnail ? (
								<img src={frame.thumbnail} alt="" className="h-full w-full object-cover" draggable={false} />
							) : (
								<span className="text-[10px] text-muted-foreground">{t("mockup.rail.noPreview")}</span>
							)}
						</span>
						<span className="truncate text-[11px] text-foreground">{frame.title}</span>
					</button>
				))}
			</div>
		</div>
	);
}
