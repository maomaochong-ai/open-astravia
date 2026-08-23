import { useTranslation } from "@astravia-org/plugin-sdk";
import { useCatalogState } from "../design-systems/index";
import { HeroArtwork } from "./HeroArtwork";

/**
 * 画廊首页的 Hero，同时也是首页唯一的工具栏。
 *
 * 首页刻意不再往宿主页头塞控件：一条系统工具栏 + 一块门面是两套语言，用户先看到的
 * 是「设置界面」而不是「作品墙」。搜索与三个动作直接长在 Hero 里，页头只留窗口拖拽区。
 * 「全部设计」列表页反过来——那里没有 Hero，工具栏仍回到页头（见 GalleryToolbar）。
 *
 * 不做成卡片：Hero 是页面本身的顶部，加了圆角描边就变成「页面里的一个控件」。
 * 层次全部由光晕、点阵与底部发丝线承担。
 */
export interface GalleryHeroProps {
	/** 一张卡 = 一个项目。 */
	projectCount: number;
	/** 所有项目里的设计份数之和。 */
	designCount: number;
	empty: boolean;
	loading: boolean;
	busy: boolean;
	keyword: string;
	onKeywordChange: (keyword: string) => void;
	onRefresh: () => void;
	onImport: () => void;
	onCreate: () => void;
}

export function GalleryHero({
	projectCount,
	designCount,
	empty,
	loading,
	busy,
	keyword,
	onKeywordChange,
	onRefresh,
	onImport,
	onCreate,
}: GalleryHeroProps) {

	const { t } = useTranslation();
	const { systems } = useCatalogState();

	const stats = [
		...(empty
			? []
			: [
					t("gallery.hero.stat.projects", { count: projectCount }),
					t("gallery.hero.stat.designs", { count: designCount }),
				]),
		...(systems.length > 0 ? [t("gallery.hero.stat.styles", { count: systems.length })] : []),
	];

	return (
		// -mx-5 让光晕与发丝线通版铺到内容区两侧，Hero 因此是「页面顶部」而不是页面里的一块卡片
		// sticky：滚动时整块钉在宿主浮动页头（44px 拖拽区）之下，风格网格从它下方穿过；
		// 半透明背景 + 底边发丝线保证滑过卡片时文字仍可读。
		// pt-11：上端 44px 处在宿主浮动页头之下，内容要从它下面开始。
		<section className="astd-hero sticky isolate top-0 z-10 -mx-5 mb-6 overflow-hidden border-b border-border/50 bg-background/90 px-5 pb-4 pt-11 backdrop-blur-sm">
			<div className="astd-hero-glow pointer-events-none absolute inset-0 -z-10" aria-hidden />
			<div className="astd-hero-dots pointer-events-none absolute inset-0 -z-10" aria-hidden />
			{/* 插画在窄屏直接不渲染：挤到文字上会两边都难看。整幅收在 Hero 内，
			    顶端不许伸出去被裁——硬裁切线在页头交界处非常显眼 */}
			<HeroArtwork className="pointer-events-none absolute -right-4 bottom-1 -z-10 hidden h-[88%] w-auto lg:block" />

			<div className="flex max-w-3xl flex-wrap items-center gap-2">
				<div className="relative">
					<svg
						viewBox="0 0 24 24"
						className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						aria-hidden
					>
						<circle cx="11" cy="11" r="7" />
						<path d="M20 20l-3.5-3.5" strokeLinecap="round" />
					</svg>
					<input
						value={keyword}
						onChange={(event) => onKeywordChange(event.target.value)}
						placeholder={t("gallery.search")}
						aria-label={t("gallery.search")}
						className="astd-hero-field h-8 w-56 rounded-lg pl-9 pr-3 text-xs text-foreground outline-none transition-all placeholder:text-muted-foreground focus:w-64"
					/>
				</div>

				<button
					type="button"
					onClick={onCreate}
					disabled={busy}
					className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground shadow-sm transition-all hover:-translate-y-px hover:shadow-md disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none"
				>
					<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
						<path d="M12 5v14M5 12h14" strokeLinecap="round" />
					</svg>
					{t("gallery.hero.create")}
				</button>
				<button
					type="button"
					onClick={onImport}
					disabled={busy}
					className="astd-hero-field flex h-8 items-center rounded-lg px-3 text-xs text-foreground transition-colors hover:bg-accent/60 disabled:opacity-40"
				>
					{t("gallery.action.import")}
				</button>
				<button
					type="button"
					onClick={onRefresh}
					disabled={loading}
					aria-label={t("gallery.action.refresh")}
					title={t("gallery.action.refresh")}
					className="astd-hero-field flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground disabled:opacity-40"
				>
					<svg
						viewBox="0 0 24 24"
						className={`size-4 ${loading ? "animate-spin" : ""}`}
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						aria-hidden
					>
						<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</button>
			</div>
			{stats.length > 0 ? (
				<ul className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
					{stats.map((stat, index) => (
						<li key={stat} className="flex items-center gap-2 tabular-nums">
							{index > 0 ? <span aria-hidden className="size-1 rounded-full bg-current opacity-40" /> : null}
							{stat}
						</li>
					))}
				</ul>
			) : null}
		</section>
	);
}
