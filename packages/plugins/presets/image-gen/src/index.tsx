import {
	type CardDescriptor,
	definePlugin,
	type PluginCardProps,
	type PluginContext,
	type PluginImageRef,
	type PluginPendingToolCall,
	useActiveConversation,
	usePromptAttachment,
	useTranslation,
} from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./style.css";
import { createImageRepository, type ImageRepository } from "./image-repository";
import { registerImageTools } from "./image-tools";

/**
 * Card type this plugin renders. Both this renderer registration and the
 * plugin-owned image tools' card descriptors agree on this exact string.
 */
const PREVIEW_CARD_TYPE = "image-gen:preview";

/** Payload carried by an image preview card descriptor. */
interface ImageCardPayload {
	/** Settled refs produced by the tool (text-to-image / image-to-image result). */
	images?: PluginImageRef[];
	/** Source image id while an edit is in-flight (anchors the lineage + skeleton). */
	editingImageId?: string;
}

// ─── Plugin-internal shared state ───
// The preview swiper lives in the same Module Federation instance across all
// messages. The "currently attached for edit" image is host state (read via
// usePromptAttachment) — a single source of truth shared with the input-bar
// capsule, so the swiper highlight clears automatically on send / capsule close
// / session switch. Picking a target goes through ui.setPromptAttachment.

let pluginCtx: PluginContext | null = null;
let imageRepository: ImageRepository | null = null;

/** Reactive edit lineage (oldest → newest) for an image id. */
// Module-level lineage cache. Critical for virtualization: the message list
// unmounts an image card when it scrolls far off-screen and REMOUNTS it on the
// way back. Without a cache the remounted hook starts at [] and re-fetches async,
// so the card paints empty → refs → lineage — a visible flicker plus a height
// re-measure that jerks the scroll position right as the card re-enters the
// viewport. Seeding state from the cache makes a remount paint the final content
// synchronously in one frame (no flicker, stable height); the refetch only
// reconciles changes (e.g. a new version appended by a later edit).
const lineageCache = new Map<string, PluginImageRef[]>();

function useLineage(imageId: string | undefined): PluginImageRef[] {
	const [lineage, setLineage] = useState<PluginImageRef[]>(() =>
		imageId ? (lineageCache.get(imageId) ?? []) : [],
	);
	// Re-fetch when a turn ends: a completed edit appends a new version to some
	// lineage, and every card must re-evaluate (so a superseded turn self-hides).
	const { isStreaming } = useActiveConversation();
	useEffect(() => {
		if (!imageId || !imageRepository) {
			setLineage([]);
			return;
		}
		const cached = lineageCache.get(imageId);
		if (cached) setLineage(cached); // paint cached synchronously; refetch reconciles
		let cancelled = false;
		void imageRepository
			.lineage(imageId)
			.then((refs) => {
				const next = refs.length > 0 ? refs : [];
				lineageCache.set(imageId, next);
				if (!cancelled) setLineage(next);
			})
			.catch(() => {
				if (!cancelled && !cached) setLineage([]);
			});
		return () => {
			cancelled = true;
		};
	}, [imageId, isStreaming]);
	return lineage;
}

async function downloadImage(ref: PluginImageRef): Promise<void> {
	const response = await fetch(ref.url);
	const blob = await response.blob();
	const objectUrl = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = objectUrl;
	anchor.download = `${ref.id}.${(ref.mimeType ?? "image/png").split("/")[1] ?? "png"}`;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(objectUrl);
}

// ─── Icons (created at render — never at module top level in an MF remote) ───

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function IconImage({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" {...stroke} className={className}>
			<rect x="3" y="3" width="18" height="18" rx="3" />
			<circle cx="8.5" cy="8.5" r="1.6" />
			<path d="M21 15.5l-4.5-4.5L5 22" />
		</svg>
	);
}

function IconEdit({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" {...stroke} className={className}>
			<path d="M12 20h9" />
			<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
		</svg>
	);
}

function IconDownload({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" {...stroke} className={className}>
			<path d="M12 3v12" />
			<path d="M7 11l5 5 5-5" />
			<path d="M5 21h14" />
		</svg>
	);
}

function IconRefresh({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" {...stroke} className={className}>
			<path d="M21 12a9 9 0 1 1-2.64-6.36" />
			<path d="M21 3v5h-5" />
		</svg>
	);
}

function IconChevron({ className, dir }: { className?: string; dir: "left" | "right" }) {
	return (
		<svg viewBox="0 0 24 24" {...stroke} className={className}>
			<path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
		</svg>
	);
}

// ─── Shared UI ───

const subtleBorder = "color-mix(in srgb, var(--foreground) 10%, transparent)";

/** Icon-only action button, designed to overlay an image (translucent dark pill). */
function IconButton({
	icon,
	title,
	onClick,
}: {
	icon: ReactNode;
	title: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			title={title}
			onClick={onClick}
			className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-lg text-white/90 backdrop-blur-md transition-colors hover:text-white"
			style={{ background: "color-mix(in srgb, black 42%, transparent)" }}
			onMouseEnter={(e) => {
				e.currentTarget.style.background = "color-mix(in srgb, black 58%, transparent)";
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.background = "color-mix(in srgb, black 42%, transparent)";
			}}
		>
			<span className="h-3.5 w-3.5">{icon}</span>
		</button>
	);
}

// Solid color blobs that, once heavily blurred by the container, melt into a
// chaotic flowing ripple — mirrors the desktop-app active theme card background.
const SKELETON_BLOBS: { left: string; top: string; w: string; h: string; rotate: number; color: string }[] = [
	{ left: "-15%", top: "-20%", w: "75%", h: "75%", rotate: -8, color: "var(--primary)" },
	{ left: "55%", top: "-15%", w: "70%", h: "70%", rotate: 12, color: "var(--accent)" },
	{ left: "-10%", top: "55%", w: "70%", h: "75%", rotate: 18, color: "var(--ring)" },
	{ left: "45%", top: "50%", w: "75%", h: "70%", rotate: -14, color: "var(--chart-2)" },
	{ left: "25%", top: "20%", w: "55%", h: "60%", rotate: 6, color: "var(--chart-4)" },
];

/** Flowing color-blob skeleton with a pulsing center icon. `className` sizes it. */
function GenerationSkeleton({ className = "aspect-square w-full max-w-[300px]" }: { className?: string }) {
	const { t } = useTranslation();
	return (
		<div
			className={`imagegen-fade-in relative shrink-0 overflow-hidden rounded-2xl border ${className}`}
			style={{ borderColor: subtleBorder, background: "var(--background)" }}
		>
			{/* blob 层：居中的大正方形旋转层 + 重度模糊。正方形 180% 宽，任意旋转角内切圆都盖满卡片 */}
			<div className="absolute inset-0 flex items-center justify-center">
				<div className="imagegen-blob-spin relative aspect-square w-[180%]" style={{ filter: "blur(26px) saturate(120%)" }}>
					{SKELETON_BLOBS.map((b, i) => (
						<div
							key={i}
							className="absolute"
							style={{ left: b.left, top: b.top, width: b.w, height: b.h, transform: `rotate(${b.rotate}deg)` }}
						>
							<div
								className="imagegen-blob-ripple h-full w-full rounded-full"
								style={{
									background: b.color,
									// 时长/相位各自错开，叠加后形成无规律混沌涟漪
									animationDuration: `${5 + i * 1.3}s`,
									animationDelay: `${i * -1.7}s`,
								}}
							/>
						</div>
					))}
				</div>
			</div>
			{/* 中心呼吸图标 */}
			<div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
				<div className="imagegen-pulse text-white" style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.35))" }}>
					<span className="icon-[solar--gallery-bold] block h-9 w-9" />
				</div>
				<span className="text-[11px] font-medium tracking-wide text-white" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.4)" }}>
					{t("ui.skeleton.processing")}
				</span>
			</div>
		</div>
	);
}

// ─── Horizontal version swiper ───

const SWIPER_ITEM = "h-64"; // 256px tall items; width auto by aspect ratio

/**
 * One image in the swiper. Hover reveals 编辑 / 导出 over the top-right corner.
 * The image the user picked for editing gets a thick primary border.
 */
function SwiperItem({
	ref,
	group,
	attached,
	onEdit,
	onLoad,
}: {
	ref: PluginImageRef;
	group: PluginImageRef[];
	attached: boolean;
	onEdit: (ref: PluginImageRef) => void;
	onLoad: () => void;
}) {
	// Hover-only reveal via explicit pointer state (not Tailwind group-hover —
	// it's unreliable in this MF-remote CSS build). Icons hidden at rest.
	const [hover, setHover] = useState(false);
	const { t } = useTranslation();
	return (
		<div
			onPointerEnter={() => setHover(true)}
			onPointerLeave={() => setHover(false)}
			className={`relative shrink-0 overflow-hidden rounded-xl ${attached ? "border-2" : "border"}`}
			style={{
				borderColor: attached ? "var(--primary)" : subtleBorder,
				boxShadow: attached ? "0 0 0 3px color-mix(in srgb, var(--primary) 28%, transparent)" : undefined,
			}}
		>
			<img
				src={ref.url}
				alt={t("ui.alt.generatedImage")}
				onLoad={onLoad}
				onClick={() => pluginCtx?.ui.previewImage(ref, group)}
				className={`block w-auto cursor-zoom-in object-cover ${SWIPER_ITEM}`}
			/>
			<div
				className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1.5"
				style={{ opacity: hover ? 1 : 0, pointerEvents: hover ? "auto" : "none", transition: "opacity 150ms" }}
			>
				<IconButton icon={<IconEdit className="h-3.5 w-3.5" />} title={t("ui.action.edit")} onClick={() => onEdit(ref)} />
				<IconButton icon={<IconDownload className="h-3.5 w-3.5" />} title={t("ui.action.download")} onClick={() => void downloadImage(ref)} />
			</div>
		</div>
	);
}

/**
 * Versions laid out left→right, NEWEST first. Overflows the row when there are
 * many; left/right chevrons scroll it. A leading "generating" skeleton is shown
 * at the front (and the row scrolls to the front) while a turn is producing the
 * next version.
 */
function ImageSwiper({
	versions,
	leadingSkeleton,
	attachedId,
	onEdit,
}: {
	versions: PluginImageRef[];
	leadingSkeleton: boolean;
	attachedId: string | null;
	onEdit: (ref: PluginImageRef) => void;
}) {
	const ordered = useMemo(() => [...versions].reverse(), [versions]); // newest first
	const scrollRef = useRef<HTMLDivElement>(null);
	// 分别跟踪两端是否还能继续滚动：决定左右「渐隐遮罩 + 箭头」各自的出现。
	const [canPrev, setCanPrev] = useState(false);
	const [canNext, setCanNext] = useState(false);

	const measure = (): void => {
		const el = scrollRef.current;
		if (!el) return;
		setCanPrev(el.scrollLeft > 1);
		setCanNext(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
	};

	// Re-measure when the version set changes; keep the newest (front) in view.
	useEffect(() => {
		measure();
		scrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
	}, [ordered.length, leadingSkeleton]);

	useEffect(() => {
		const onResize = (): void => measure();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	// 点击箭头翻动一整屏（可视宽度），与场景卡片 swiper 的「切屏」手感一致。
	const scrollByView = (dir: -1 | 1): void => {
		const el = scrollRef.current;
		if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
	};

	// 左右箭头绝对定位压在首/末图边缘、略探入两侧 gutter（图片行与正文左右对齐），仅 hover 时淡入。
	const [hover, setHover] = useState(false);
	return (
		<div
			className="relative"
			onPointerEnter={() => setHover(true)}
			onPointerLeave={() => setHover(false)}
		>
			<div
				ref={scrollRef}
				onScroll={measure}
				className="imagegen-swiper flex gap-2 overflow-x-auto scroll-smooth"
			>
				{leadingSkeleton && <GenerationSkeleton className={`aspect-square ${SWIPER_ITEM}`} />}
				{ordered.map((ref) => (
					<SwiperItem
						key={ref.id}
						ref={ref}
						group={ordered}
						attached={ref.id === attachedId}
						onEdit={onEdit}
						onLoad={measure}
					/>
				))}
			</div>
			{canPrev && (
				<>
					<EdgeFade dir="left" />
					<ArrowButton dir="left" visible={hover} onClick={() => scrollByView(-1)} />
				</>
			)}
			{canNext && (
				<>
					<EdgeFade dir="right" />
					<ArrowButton dir="right" visible={hover} onClick={() => scrollByView(1)} />
				</>
			)}
		</div>
	);
}

/** 两端渐隐遮罩：从背景色淡出到透明，提示该侧还有更多图片可滚动。 */
function EdgeFade({ dir }: { dir: "left" | "right" }) {
	return (
		<div
			aria-hidden
			className={`pointer-events-none absolute inset-y-0 z-[5] w-12 ${dir === "left" ? "left-0" : "right-0"}`}
			style={{
				background: `linear-gradient(to ${dir === "left" ? "right" : "left"}, var(--background), transparent)`,
			}}
		/>
	);
}

function ArrowButton({ dir, visible, onClick }: { dir: "left" | "right"; visible: boolean; onClick: () => void }) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			onClick={onClick}
			title={dir === "left" ? t("ui.swiper.prev") : t("ui.swiper.next")}
			className={`absolute top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-white/90 backdrop-blur-md transition-all hover:text-white ${dir === "left" ? "left-0" : "right-0"}`}
			style={{
				background: "color-mix(in srgb, black 48%, transparent)",
				opacity: visible ? 1 : 0,
				pointerEvents: visible ? "auto" : "none",
			}}
		>
			<IconChevron dir={dir} className="h-4 w-4" />
		</button>
	);
}

// ─── Card renderer: per-message preview card ───
//
// Purely descriptor-driven: settled cards carry their refs in payload.images;
// the host synthesizes a `pending` card (payload.editingImageId for edits) for
// the in-flight skeleton. Cross-turn dedup (one lineage shows only under its
// latest turn) is the HOST's job now (by descriptor key = rootId) — this
// component no longer self-hides superseded turns.

function ImagePreviewCard({ descriptor, pending }: PluginCardProps) {
	const { t } = useTranslation();
	const payload = (descriptor.payload ?? {}) as ImageCardPayload;
	const refs = payload.images;
	const editingImageId = payload.editingImageId;
	// While editing, the lineage anchors on the source image even before the new
	// version lands; otherwise on this card's own image.
	const baseId = editingImageId ?? refs?.[0]?.id;
	const lineage = useLineage(baseId);
	// Single source of truth for the highlight — the host edit-attachment atom.
	const attachedId = usePromptAttachment()?.id ?? null;

	const versions = lineage.length > 0 ? lineage : (refs ?? []);

	// Toggle: clicking 编辑 on the already-attached image clears it; otherwise attach.
	const onEdit = (ref: PluginImageRef): void => {
		pluginCtx?.ui.setPromptAttachment(
			ref.id === attachedId
				? null
				: {
						id: ref.id,
						label: t("ui.action.edit"),
						icon: "icon-[solar--gallery-linear]",
						instructions: [
							`The user selected image id ${ref.id} for editing. ` +
								`Call edit_image with sourceImageId="${ref.id}" and the user's requested change. ` +
								"Do not call generate_image and do not answer with text only.",
						],
					},
		);
	};

	// In-flight edit: this turn is producing the next version — show the lineage
	// (the source's versions) with a leading "generating" skeleton at the front.
	if (pending && editingImageId) {
		return (
			<div className="flex flex-col gap-2 py-1">
				<ImageSwiper versions={versions} leadingSkeleton attachedId={attachedId} onEdit={onEdit} />
			</div>
		);
	}
	// Fresh generation (no edit target, nothing produced yet): standalone skeleton.
	if (pending) {
		return (
			<div className="py-1">
				<GenerationSkeleton />
			</div>
		);
	}
	if (versions.length === 0) return null;

	return (
		<div className="flex flex-col gap-2 py-1">
			<ImageSwiper versions={versions} leadingSkeleton={false} attachedId={attachedId} onEdit={onEdit} />
		</div>
	);
}

/** Resolve a source image's lineage rootId from the module cache (sync, best-effort). */
function cachedRootId(sourceImageId: string): string | undefined {
	const lineage = lineageCache.get(sourceImageId);
	return lineage?.[0]?.rootId ?? undefined;
}

/**
 * Host calls this for each in-flight tool_call to synthesize a skeleton card.
 * For edits we carry the source id (lineage anchor) and, when known, the
 * lineage rootId as the descriptor key so the prior settled card (same key)
 * hides while editing — exactly the old behaviour, now via host dedup.
 */
function pendingPreviewCard(toolCall: PluginPendingToolCall): CardDescriptor | null {
	if (toolCall.toolName !== "generate_image" && toolCall.toolName !== "edit_image") return null;
	if (toolCall.toolName === "edit_image") {
		const sourceId = typeof toolCall.args.sourceImageId === "string" ? toolCall.args.sourceImageId : undefined;
		const key = sourceId ? cachedRootId(sourceId) : undefined;
		return { type: PREVIEW_CARD_TYPE, ...(key ? { key } : {}), payload: { editingImageId: sourceId } };
	}
	// Fresh generation: a new lineage, no key yet — standalone skeleton.
	return { type: PREVIEW_CARD_TYPE, payload: {} };
}

// ─── Activity tab: 生图历史 (all edit lineages in the current session) ───

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Agent session id = the UUID embedded in the session file path. */
function sessionIdFromPath(sessionPath: string | null): string | undefined {
	return sessionPath?.match(UUID_RE)?.[0];
}

// ─── Stacked group + expandable grid (生图历史 内的紧凑展示) ───

const STACK_VISIBLE = 4; // 最多铺 4 张，超出第 5 个位置显示「+n」
const ITEM_MAX = 96; // 单个 item 的最大宽度（px）；超过即增列
const GRID_GAP = 8; // item 间距（px）
const MIN_COLS = 4; // 每行最少 4 个 item 宽度

/**
 * 测量容器宽度，算出「列数 + 单 item 宽度」。规则：列数至少 MIN_COLS，
 * 容器变宽到 item 会超过 ITEM_MAX 时再加列。堆叠/网格共用同一 item 宽度，视觉一致。
 */
function useGridMetrics(): { ref: React.RefObject<HTMLDivElement | null>; cols: number; item: number } {
	const ref = useRef<HTMLDivElement>(null);
	const [m, setM] = useState({ cols: MIN_COLS, item: ITEM_MAX });
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const compute = (): void => {
			const w = el.clientWidth;
			if (!w) return;
			const cols = Math.max(MIN_COLS, Math.floor((w + GRID_GAP) / (ITEM_MAX + GRID_GAP)));
			const item = (w - GRID_GAP * (cols - 1)) / cols;
			setM((prev) => (prev.cols === cols && Math.abs(prev.item - item) < 0.5 ? prev : { cols, item }));
		};
		compute();
		const ro = new ResizeObserver(compute);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	return { ref, ...m };
}

/** 堆叠中的一张缩略图：方形（尺寸由容器算出）、点击预览，命中编辑目标时高亮描边。 */
function StackThumb({
	imageRef,
	size,
	overlap,
	offset,
	attached,
}: {
	imageRef: PluginImageRef;
	size: number;
	overlap: number;
	offset: number;
	attached: boolean;
}) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			title={t("ui.action.preview")}
			onClick={() => pluginCtx?.ui.previewImage(imageRef)}
			className="imagegen-fade-in relative shrink-0 cursor-zoom-in overflow-hidden rounded-lg border transition-transform hover:-translate-y-0.5"
			style={{
				height: size,
				width: size,
				marginLeft: offset > 0 ? -overlap : 0,
				zIndex: 10 - offset,
				borderColor: attached ? "var(--primary)" : subtleBorder,
				boxShadow: attached
					? "0 0 0 2px color-mix(in srgb, var(--primary) 32%, transparent)"
					: "0 1px 4px color-mix(in srgb, black 22%, transparent)",
				background: "var(--background)",
			}}
		>
			<img src={imageRef.url} alt={t("ui.alt.generatedImage")} className="h-full w-full object-cover" />
		</button>
	);
}

/** 「+n」磁贴：以下一张图为底、压暗叠加，点击把整组展开成网格。 */
function PlusTile({
	imageRef,
	n,
	size,
	overlap,
	onClick,
}: {
	imageRef: PluginImageRef;
	n: number;
	size: number;
	overlap: number;
	onClick: () => void;
}) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			title={t("ui.action.expandAll")}
			onClick={onClick}
			className="imagegen-fade-in relative shrink-0 overflow-hidden rounded-lg border transition-transform hover:-translate-y-0.5"
			style={{
				height: size,
				width: size,
				marginLeft: -overlap,
				zIndex: 1,
				borderColor: subtleBorder,
				boxShadow: "0 1px 4px color-mix(in srgb, black 22%, transparent)",
				background: "var(--background)",
			}}
		>
			<img src={imageRef.url} alt="" className="h-full w-full object-cover" />
			<span
				className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-white backdrop-blur-[1px]"
				style={{ background: "color-mix(in srgb, black 52%, transparent)" }}
			>
				+{n}
			</span>
		</button>
	);
}

/** 展开后的网格单元：方形、宽度跟随网格列（1fr），点击预览，命中编辑目标时高亮描边。 */
function GridItem({ imageRef, attached }: { imageRef: PluginImageRef; attached: boolean }) {
	const { t } = useTranslation();
	return (
		<button
			type="button"
			title={t("ui.action.preview")}
			onClick={() => pluginCtx?.ui.previewImage(imageRef)}
			className={`imagegen-fade-in relative aspect-square cursor-zoom-in overflow-hidden rounded-lg ${attached ? "border-2" : "border"}`}
			style={{
				borderColor: attached ? "var(--primary)" : subtleBorder,
				boxShadow: attached ? "0 0 0 2px color-mix(in srgb, var(--primary) 28%, transparent)" : undefined,
				background: "var(--background)",
			}}
		>
			<img src={imageRef.url} alt={t("ui.alt.generatedImage")} className="h-full w-full object-cover" />
		</button>
	);
}

/**
 * 历史里的一组（一条 lineage）：默认堆叠展示（newest first，最多 4 张 + 「+n」），
 * 点击「+n」或标题右侧的张数把整组展开成响应式网格，可再收起。item 宽度随容器走
 * （封顶 ITEM_MAX，至少 MIN_COLS 列），堆叠与网格共用同一宽度。
 */
function StackedGroup({
	versions,
	label,
	attachedId,
}: {
	versions: PluginImageRef[];
	label: string;
	attachedId: string | null;
}) {
	const { t } = useTranslation();
	const [expanded, setExpanded] = useState(false);
	const ordered = useMemo(() => [...versions].reverse(), [versions]); // newest first
	const hasMore = ordered.length > STACK_VISIBLE;
	const visible = hasMore ? ordered.slice(0, STACK_VISIBLE) : ordered;
	const extra = ordered.length - STACK_VISIBLE;
	const { ref, cols, item } = useGridMetrics();
	const overlap = hasMore ? Math.round(item * 0.34) : 0;

	return (
		<div ref={ref} className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between px-0.5">
				<span className="text-[11px] font-medium" style={{ color: "var(--muted-foreground)" }}>
					{label}
				</span>
				<button
					type="button"
					onClick={() => setExpanded((e) => !e)}
					className="text-[11px] transition-colors hover:text-foreground"
					style={{ color: "var(--muted-foreground)" }}
				>
					{expanded ? t("ui.stack.collapse") : t("ui.stack.count", { count: ordered.length })}
				</button>
			</div>
			{expanded ? (
				<div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: GRID_GAP }}>
					{ordered.map((ref) => (
						<GridItem key={ref.id} imageRef={ref} attached={ref.id === attachedId} />
					))}
				</div>
			) : (
				<div className="flex items-center pt-0.5" style={{ gap: hasMore ? 0 : GRID_GAP }}>
					{visible.map((ref, i) => (
						<StackThumb key={ref.id} imageRef={ref} size={item} overlap={overlap} offset={i} attached={ref.id === attachedId} />
					))}
					{hasMore && (
						<PlusTile imageRef={ordered[STACK_VISIBLE]!} n={extra} size={item} overlap={overlap} onClick={() => setExpanded(true)} />
					)}
				</div>
			)}
		</div>
	);
}

function GenHistoryPanel() {
	const { t } = useTranslation();
	const { sessionPath, isStreaming } = useActiveConversation();
	const sessionId = useMemo(() => sessionIdFromPath(sessionPath), [sessionPath]);
	const attachedId = usePromptAttachment()?.id ?? null;
	const [lineages, setLineages] = useState<PluginImageRef[][]>([]);
	const reqId = useRef(0);

	const refetch = useCallback(() => {
		if (!sessionId || !imageRepository) {
			setLineages([]);
			return;
		}
		const my = ++reqId.current;
		void imageRepository
			.sessionLineages(sessionId)
			.then((result) => {
				if (my === reqId.current) setLineages(result);
			})
			.catch(() => {
				if (my === reqId.current) setLineages([]);
			});
	}, [sessionId]);

	useEffect(() => {
		refetch();
	}, [refetch]);

	// A turn just finished — a new image may have landed; refresh.
	const wasStreaming = useRef(isStreaming);
	useEffect(() => {
		if (wasStreaming.current && !isStreaming) refetch();
		wasStreaming.current = isStreaming;
	}, [isStreaming, refetch]);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: subtleBorder }}>
				<span className="text-[12px] font-semibold text-foreground/80">
					{t("history.title")}
					{lineages.length > 0 ? t("history.groupCount", { count: lineages.length }) : ""}
				</span>
				<Button type="button" variant="ghost" size="icon-xs" onClick={() => refetch()} title={t("ui.action.refresh")}>
					<IconRefresh className="h-3.5 w-3.5" />
				</Button>
			</div>
			{lineages.length === 0 ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
					<div className="imagegen-pulse" style={{ color: "var(--muted-foreground)" }}>
						<IconImage className="h-10 w-10" />
					</div>
					<p className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
						{sessionId ? t("history.empty.hasSession") : t("history.empty.noSession")}
					</p>
				</div>
			) : (
				<div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
					{lineages.map((versions, i) => (
						<StackedGroup
							key={versions[0]?.id ?? i}
							versions={versions}
							label={t("history.groupLabel", { index: lineages.length - i })}
							attachedId={attachedId}
						/>
					))}
				</div>
			)}
		</div>
	);
}

export default definePlugin({
	activate(ctx) {
		// NOTE: pluginCtx is intentionally never nulled in deactivate(). Under React
		// StrictMode the host double-invokes load/dispose; a racing deactivate()
		// could run after re-activate() and permanently null the ctx live components
		// read, breaking 编辑/生成. The next activate() re-sets it.
		pluginCtx = ctx;
		imageRepository = createImageRepository(ctx.storage);
		registerImageTools(ctx, imageRepository);
		ctx.ui.registerInputAction({
			id: "image-mode",
			label: "%action.imageMode.label%",
			icon: <IconImage className="h-3.5 w-3.5" />,
			// 仅交互式对话场景出现（批量/自动化/知识加工不放生图开关）；再叠加
			// requiresActiveTool 跟随 generate_image 工具是否激活。
			scope_use: ["conversation", "project", "im-claw", "cli"],
			// 跟随 generate_image 工具的 scope：批量任务等屏蔽生图的场景里不显示这个 badge。
			requiresActiveTool: "generate_image",
			decoratePrompt: () => ({
				instructions: [
					"The user enabled image creation for this turn. Produce an actual image instead of only describing one. " +
						"Use generate_image for a new scene, or edit_image when the request modifies a recent generated image.",
				],
			}),
		});
		ctx.ui.registerCardRenderer({
			type: PREVIEW_CARD_TYPE,
			component: ImagePreviewCard,
			title: "%card.preview.title%",
			icon: <IconImage className="h-3.5 w-3.5" />,
			pendingFor: pendingPreviewCard,
		});
		ctx.ui.registerActivityTab({
			id: "history",
			label: "%tab.history.label%",
			icon: <IconImage className="h-4 w-4" />,
			component: GenHistoryPanel,
			scope_use: ["conversation", "project", "im-claw", "cli"],
			// 无历史时不上栏；generate_image / edit_image 成功后 openActivityTab 再挂上。
			initiallyVisible: false,
		});
	},
});
