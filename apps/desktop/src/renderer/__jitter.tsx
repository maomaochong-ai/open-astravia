/** TEMPORARY diagnosis harness — delete after the message-card jitter bug is fixed. */
import {
	MessageCardsView,
	MessageFeed,
	MessageFeedLayout,
	MessageListFooter as MessageListFooterPrimitive,
} from "@vetta-org/theme-ui/chat";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useMessageFeedScrollModel } from "@shared/components/message-feed/useMessageFeedScrollModel";
import "./styles.css";

const STREAMING_OVERSCAN = 80;
const IDLE_OVERSCAN = 400;
const STREAMING_MIN_OVERSCAN_ITEM_COUNT = { top: 8, bottom: 2 };
const IDLE_MIN_OVERSCAN_ITEM_COUNT = { top: 12, bottom: 4 };
const STREAMING_INCREASE_VIEWPORT_BY = { top: 400, bottom: 80 };
const IDLE_INCREASE_VIEWPORT_BY = { top: 600, bottom: 200 };
const DEFAULT_ITEM_HEIGHT = 200;

interface Item {
	readonly id: string;
	readonly lines: number;
	readonly kind: "user" | "agent";
	readonly text?: string;
	readonly cards?: number;
	readonly pending?: boolean;
}

const params = new URLSearchParams(location.search);
const COUNT = Number(params.get("count") ?? 40);
const SHOTS = Number(params.get("shots") ?? 4);

function makeItems(count: number): Item[] {
	const items: Item[] = [];
	for (let i = 0; i < count; i++) {
		items.push({ id: `m${i}`, kind: i % 2 === 0 ? "user" : "agent", lines: 1 + ((i * 7919) % 23) });
	}
	return items;
}

/** data URL images with distinct aspect ratios, resolved after a delay to mimic disk loads. */
function makeImage(w: number, h: number): string {
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d")!;
	ctx.fillStyle = `hsl(${(w * h) % 360} 60% 45%)`;
	ctx.fillRect(0, 0, w, h);
	return canvas.toDataURL("image/png");
}

/** Faithful copy of the plugin's SwiperShell (packages/plugins/presets/vetta-ui-design). */
function SwiperShell({
	children,
	resetKey,
	className,
}: {
	children: ReactNode;
	resetKey?: string | number;
	className?: string;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [canPrev, setCanPrev] = useState(false);
	const [canNext, setCanNext] = useState(false);
	const [hover, setHover] = useState(false);
	const measure = (): void => {
		const el = scrollRef.current;
		if (!el) return;
		setCanPrev(el.scrollLeft > 1);
		setCanNext(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
	};
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const observer = new ResizeObserver(() => measure());
		observer.observe(el);
		for (const child of Array.from(el.children)) observer.observe(child);
		return () => observer.disconnect();
	}, [resetKey]);
	useEffect(() => {
		measure();
		scrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
	}, [resetKey]);
	const fade = (dir: "left" | "right") => (
		<div
			aria-hidden
			className={`pointer-events-none absolute inset-y-0 z-[5] w-10 ${dir === "left" ? "left-0" : "right-0"}`}
			style={{ background: `linear-gradient(to ${dir === "left" ? "right" : "left"}, var(--background), transparent)` }}
		/>
	);
	return (
		<div className="relative" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
			<div ref={scrollRef} onScroll={measure} className={`flex overflow-x-auto scroll-smooth ${className ?? ""}`} style={{ scrollbarWidth: "none" }}>
				{children}
			</div>
			{canPrev && fade("left")}
			{canNext && fade("right")}
			{hover ? null : null}
		</div>
	);
}

const ITEM_HEIGHT = "h-48";

function ScreenshotSwiperMock({ shots, pending }: { shots: number; pending: boolean }) {
	const [urls, setUrls] = useState<string[]>([]);
	useEffect(() => {
		let cancelled = false;
		const timers: number[] = [];
		// listSnapshots() resolves, then each <img> finishes loading at its own time.
		timers.push(
			window.setTimeout(() => {
				if (cancelled) return;
				const all = Array.from({ length: shots }, (_, i) => makeImage(1200 + i * 337, 800 + i * 53));
				// staggered arrival, like vetta-file:// fetches completing one by one
				all.forEach((url, i) => {
					timers.push(
						window.setTimeout(() => {
							if (!cancelled) setUrls((prev) => [...prev, url]);
						}, i * 220),
					);
				});
			}, 60),
		);
		return () => {
			cancelled = true;
			for (const t of timers) clearTimeout(t);
		};
	}, [shots]);
	if (urls.length === 0 && !pending) return null;
	return (
		<div className="py-1" data-vetta-plugin-card="screenshot">
			<SwiperShell className="gap-2" resetKey={`${urls.length}:${pending}`}>
				{pending && (
					<div
						className={`flex w-24 shrink-0 items-center justify-center rounded-lg border border-border ${ITEM_HEIGHT}`}
						style={{ background: "color-mix(in oklab, var(--foreground) 6%, transparent)" }}
					>
						<span className="px-1 text-center text-[10px] text-muted-foreground">截图中</span>
					</div>
				)}
				{urls.map((url) => (
					<button key={url} type="button" className="shrink-0 overflow-hidden rounded-lg border border-border">
						<img src={url} alt="" className={`block w-auto cursor-zoom-in object-contain ${ITEM_HEIGHT}`} />
					</button>
				))}
			</SwiperShell>
		</div>
	);
}

function Harness(): JSX.Element {
	const [items, setItems] = useState<Item[]>(() => makeItems(COUNT));
	const [streaming, setStreaming] = useState(false);
	const scroll = useMessageFeedScrollModel<Item>({
		active: streaming,
		items,
		resetKey: "harness",
		getItemKey: (item) => item.id,
		shouldFollowOnAppend: (item) => item.kind === "user",
	});
	const itemContent = useCallback(
		(index: number, item: Item) => (
			<div data-entry-id={item.id} className={index === items.length - 1 && item.kind === "user" ? "pb-9" : "pb-5"}>
				<div className="whitespace-pre-wrap break-words text-[14px] leading-6 text-foreground">
					{`[${item.id}] `}
					{item.text ??
						Array.from({ length: item.lines }, (_, i) => `行 ${i} 这是一段用于撑开高度的消息内容 content filler. `).join("")}
				</div>
				{item.cards ? (
					<div className="mt-2">
						<MessageCardsView
							messageId={item.id}
							labels={{ layoutStacked: "stacked", layoutList: "list" }}
							cards={Array.from({ length: item.cards }, (_, i) => ({
								id: `${item.id}:c${i}`,
								title: `frame-${i}`,
								pending: Boolean(item.pending),
								body: <ScreenshotSwiperMock shots={SHOTS} pending={Boolean(item.pending)} />,
							}))}
						/>
					</div>
				) : null}
			</div>
		),
		[items.length],
	);
	const footer = useMemo(
		() => (
			<MessageFeed.Footer asChild>
				<div className="pb-16">
					<MessageListFooterPrimitive.Root />
				</div>
			</MessageFeed.Footer>
		),
		[],
	);
	(window as unknown as Record<string, unknown>).__harness = {
		setStreaming,
		scroller: () => scroll.scrollerElement,
		/** attach a card area to the tail message, like a settled vetd_screenshot tool call */
		addCard: (cards = 1, pending = false) =>
			setItems((prev) => prev.map((it, i) => (i === prev.length - 1 ? { ...it, kind: "agent" as const, cards, pending } : it))),
		/** simulate token-by-token growth of the tail message */
		stream: (ticks: number) => {
			setStreaming(true);
			let n = 0;
			const id = setInterval(() => {
				n++;
				setItems((prev) =>
					prev.map((it, i) =>
						i === prev.length - 1 ? { ...it, text: `${"流式输出内容 streaming token ".repeat(n)}` } : it,
					),
				);
				if (n >= ticks) {
					clearInterval(id);
					setStreaming(false);
				}
			}, 60);
		},
	};
	return (
		<div className="flex h-full flex-col bg-background">
			<MessageFeed.Root>
				<MessageFeedLayout.Frame asChild>
					<div data-message-viewport="expanded">
						<MessageFeedLayout.Viewport>
							<MessageFeedLayout.Virtualizer asChild>
								<MessageFeed.VirtualList
									key="harness-list"
									virtuosoRef={scroll.virtuosoRef}
									restoreStateFrom={scroll.restoreStateFrom}
									scrollerRef={scroll.scrollerRef}
									items={items}
									getKey={(item) => item.id}
									atBottomStateChange={scroll.onAtBottomChange}
									atBottomThreshold={80}
									overscan={streaming ? STREAMING_OVERSCAN : IDLE_OVERSCAN}
									minOverscanItemCount={streaming ? STREAMING_MIN_OVERSCAN_ITEM_COUNT : IDLE_MIN_OVERSCAN_ITEM_COUNT}
									increaseViewportBy={streaming ? STREAMING_INCREASE_VIEWPORT_BY : IDLE_INCREASE_VIEWPORT_BY}
									defaultItemHeight={DEFAULT_ITEM_HEIGHT}
									initialTopMostItemIndex={items.length > 0 ? items.length - 1 : 0}
								>
									<MessageFeedLayout.List />
									{(item, index) => itemContent(index, item)}
									{footer}
								</MessageFeed.VirtualList>
							</MessageFeedLayout.Virtualizer>
						</MessageFeedLayout.Viewport>
					</div>
				</MessageFeedLayout.Frame>
			</MessageFeed.Root>
		</div>
	);
}

document.documentElement.setAttribute("data-mode", "dark");
createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
