import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@astravia-org/ui";

export interface SettingsSidebarChildItem {
	readonly key: string;
	readonly label: string;
	readonly icon: string;
	readonly iconUrl?: string;
	readonly title?: string;
}

export interface SettingsSidebarTabItem {
	readonly beta?: boolean;
	readonly icon: string;
	readonly key: string;
	readonly label: string;
	readonly title?: string;
	/** 可就地展开的下级入口；有值时点该行会在进入页面的同时就地展开。 */
	readonly children?: readonly SettingsSidebarChildItem[];
}

export interface SettingsSidebarViewProps {
	readonly activeTab: string;
	readonly betaBadgeLabel: string;
	readonly narrow: boolean;
	readonly onSelectTab: (tab: string) => void;
	readonly onTabIntent?: (tab: string) => void;
	/** 下级入口不是设置标签，导航由宿主决定。 */
	readonly onSelectChild?: (key: string) => void;
	/** 当前正在显示的下级入口；它所属的标签会自动展开并高亮该项。 */
	readonly activeChildKey?: string;
	readonly tabs: readonly SettingsSidebarTabItem[];
	readonly title: string;
}

function ChildIcon({ item }: { item: SettingsSidebarChildItem }): JSX.Element {
	if (item.iconUrl) return <img src={item.iconUrl} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" />;
	return <span className={cn(item.icon, "h-3.5 w-3.5 shrink-0")} />;
}

/** 渐隐高度：够看出「上/下还有内容」，又不吃掉整行。 */
const FADE_SIZE = 24;

type FadeEdges = { top: boolean; bottom: boolean };

/**
 * 隐藏滚动条的纵向滚动容器，用顶部/底部渐隐提示还能往哪边滚。
 * 用 mask 而不是叠色块，换主题后不会露出色差；只在该方向真有内容时才淡出，避免无端吃掉首尾行。
 */
function useFadeEdges(): {
	ref: React.RefObject<HTMLElement | null>;
	sync: () => void;
	maskImage: string | undefined;
} {
	const ref = useRef<HTMLElement | null>(null);
	const [edges, setEdges] = useState<FadeEdges>({ top: false, bottom: false });

	const sync = useCallback(() => {
		const el = ref.current;
		if (!el) return;
		const top = el.scrollTop > 4;
		const bottom = el.scrollHeight - el.scrollTop - el.clientHeight > 4;
		setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
	}, []);

	// 展开/收起下级入口会改变内容高度，光靠 onScroll 追不上，连内容一起观察。
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		sync();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(sync);
		observer.observe(el);
		for (const child of Array.from(el.children)) observer.observe(child);
		return () => observer.disconnect();
	}, [sync]);

	let maskImage: string | undefined;
	if (edges.top || edges.bottom) {
		const start = edges.top ? `transparent, black ${FADE_SIZE}px` : "black, black";
		const end = edges.bottom ? `black calc(100% - ${FADE_SIZE}px), transparent` : "black, black";
		maskImage = `linear-gradient(to bottom, ${start}, ${end})`;
	}
	return { ref, sync, maskImage };
}

export function SettingsSidebarView({
	activeTab,
	betaBadgeLabel,
	narrow,
	onSelectTab,
	onTabIntent,
	onSelectChild,
	activeChildKey,
	tabs,
	title,
}: SettingsSidebarViewProps): JSX.Element {
	// 展开态不是独立状态，而是「当前停在这个标签里」的表现：选中即展开，切走即收起。
	// 深链直接进到某个下级入口时也一样——它所属的标签就是当前标签。
	const activeParentKey = activeChildKey
		? (tabs.find((tab) => tab.children?.some((child) => child.key === activeChildKey))?.key ?? null)
		: null;

	const { ref, sync, maskImage } = useFadeEdges();

	return (
		<div className={cn("flex min-h-0 shrink-0 flex-col", narrow ? "w-14" : "w-[200px]")}>
			<div className={cn("drag-region", narrow ? "h-12" : "px-5 pb-2 pt-2")}>
				{!narrow && <h1 className="text-[20px] font-bold text-foreground">{title}</h1>}
			</div>
			<nav
				ref={ref}
				onScroll={sync}
				style={maskImage ? { maskImage, WebkitMaskImage: maskImage } : undefined}
				// no-scrollbar：全局 overlay 滚动条规则无 layer，Tailwind 的 hidden 压不过它。
				className={cn(
					"no-scrollbar flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto",
					narrow ? "px-2" : "px-2.5",
				)}
			>
				{tabs.map((item) => {
					// 窄侧栏没有文字位置，展开的清单读不出来，此时只保留「点进页面」。
					const expandable = !narrow && (item.children?.length ?? 0) > 0;
					const expanded = expandable && (activeTab === item.key || activeParentKey === item.key);
					return (
						<div key={item.key} className="flex flex-col">
							<div
								className={cn(
									"flex items-center rounded-lg text-[13px] font-medium transition-colors",
									activeTab === item.key
										? "bg-accent text-foreground"
										: "text-foreground hover:bg-accent/50",
								)}
							>
								<button
									type="button"
									title={item.title}
									aria-expanded={expandable ? expanded : undefined}
									// 进页面与展开清单合成一个动作：点行即导航，清单跟着选中态展开。
									onClick={() => onSelectTab(item.key)}
									onFocus={() => onTabIntent?.(item.key)}
									onMouseEnter={() => onTabIntent?.(item.key)}
									className={cn(
										"flex min-w-0 flex-1 items-center rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
										narrow ? "justify-center px-0 py-2" : "gap-2.5 py-[7px] ps-2.5 pe-2.5",
									)}
								>
									<span className={cn(item.icon, "h-4 w-4 shrink-0")} />
									{!narrow && <span className="flex-1 truncate text-left">{item.label}</span>}
									{!narrow && item.beta && (
										<span className="rounded-full border border-primary/40 px-1.5 py-px text-[9px] font-semibold uppercase leading-tight tracking-wide text-primary">
											{betaBadgeLabel}
										</span>
									)}
									{expandable && (
										<span
											aria-hidden
											className={cn(
												"icon-[solar--alt-arrow-down-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
												expanded && "rotate-180",
											)}
										/>
									)}
								</button>
							</div>
							{expanded && (
								<div className="mt-0.5 flex flex-col gap-0.5 ps-3.5">
									{item.children?.map((child) => (
										<button
											key={child.key}
											type="button"
											title={child.title ?? child.label}
											aria-current={child.key === activeChildKey ? "page" : undefined}
											onClick={() => onSelectChild?.(child.key)}
											className={cn(
												"flex min-w-0 items-center gap-2 rounded-lg py-1.5 ps-2.5 pe-2 text-[12px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
												child.key === activeChildKey
													? "bg-accent/70 text-foreground"
													: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
											)}
										>
											<ChildIcon item={child} />
											<span className="min-w-0 flex-1 truncate text-left">{child.label}</span>
										</button>
									))}
								</div>
							)}
						</div>
					);
				})}
			</nav>
		</div>
	);
}
