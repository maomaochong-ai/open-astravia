import { useTranslation } from "@astravia-org/plugin-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadRasters } from "../canvas/raster-cache";
import type { AstdFrameEntry } from "../astd/manifest-types";

interface PreviewFrameRailProps {
	frames: readonly AstdFrameEntry[];
	/** 当前地址对应的画框；地址不在画框表里时为 null，此时没有一项高亮。 */
	currentFrameId: string | null;
	/** 位图缓存的归属键（设计文档路径），见 canvas/raster-cache.ts。 */
	astdPath: string;
	onPick(frameId: string): void;
}

/**
 * 预览窗口左侧的画框缩略图列表，取代原来工具栏里的下拉选择：
 * 换页看的是画面，从一列缩略图里挑比从一串标题里挑快得多。
 *
 * 超出高度就滚动，但不显示滚动条——它挤在窄窄一条里很难看；改用上下边缘的
 * 渐隐提示「这个方向还有内容」，滚到头就撤掉。
 */
export function PreviewFrameRail({ frames, currentFrameId, astdPath, onPick }: PreviewFrameRailProps) {
	const { t } = useTranslation();
	const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, string>>(new Map());
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const [edges, setEdges] = useState({ top: false, bottom: false });

	useEffect(() => {
		let cancelled = false;
		// 缩略图直接用画布留下的缓存位图：为了一列小图再把每帧拉活体截一遍不值当。
		void loadRasters(
			astdPath,
			frames.map((frame) => frame.id),
		)
			.then((found) => {
				if (!cancelled) setThumbnails(found);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [astdPath, frames]);

	const syncEdges = useCallback((): void => {
		const element = scrollRef.current;
		if (!element) return;
		const max = element.scrollHeight - element.clientHeight;
		setEdges({ top: element.scrollTop > 1, bottom: element.scrollTop < max - 1 });
	}, []);

	useEffect(() => {
		syncEdges();
		const element = scrollRef.current;
		if (!element) return;
		const observer = new ResizeObserver(syncEdges);
		observer.observe(element);
		return () => observer.disconnect();
	}, [syncEdges]);

	if (frames.length === 0) return null;

	return (
		<div
			className="relative flex max-h-[80vh] w-24 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-2xl"
			aria-label={t("previewMode.frame")}
		>
			<div ref={scrollRef} onScroll={syncEdges} className="astd-rail-scroll flex flex-col gap-1.5 overflow-y-auto">
				{frames.map((frame) => {
					const thumbnail = thumbnails.get(frame.id);
					const current = frame.id === currentFrameId;
					return (
						<button
							key={frame.id}
							type="button"
							onClick={() => onPick(frame.id)}
							aria-current={current}
							title={frame.title || frame.id}
							className={`flex shrink-0 flex-col gap-1 rounded-lg border p-1 text-left transition-colors ${
								current ? "border-primary bg-primary/10" : "border-transparent hover:border-border"
							}`}
						>
							<span
								className="flex w-full items-center justify-center overflow-hidden rounded-md bg-muted"
								style={{ aspectRatio: `${Math.max(1, frame.width)} / ${Math.max(1, frame.height)}` }}
							>
								{thumbnail ? (
									<img src={thumbnail} alt="" className="h-full w-full object-cover" draggable={false} />
								) : null}
							</span>
							<span
								className={`truncate text-[11px] ${current ? "text-primary" : "text-muted-foreground"}`}
							>
								{frame.title || frame.id}
							</span>
						</button>
					);
				})}
			</div>
			{/* 渐隐遮罩：只在那个方向真的还有内容时出现。 */}
			{edges.top ? (
				<div className="pointer-events-none absolute inset-x-1.5 top-1.5 h-6 rounded-t-lg bg-gradient-to-b from-card to-transparent" />
			) : null}
			{edges.bottom ? (
				<div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 h-6 rounded-b-lg bg-gradient-to-t from-card to-transparent" />
			) : null}
		</div>
	);
}
