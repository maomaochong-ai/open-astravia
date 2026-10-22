import { useTranslation } from "@astravia-org/plugin-sdk";
import { useCatalogState } from "../design-systems/index";
import { SHARE_EXTENSION } from "../export/share-format";
import { HeroArtwork } from "./HeroArtwork";

/**
 * 画廊首页的 Hero：只负责「这块页面是什么」和真实统计。
 *
 * 搜索、新建、导入、刷新这些动作全部在宿主页头（见 GalleryToolbar）：页头是常驻的，
 * Hero 会随内容滚走，动作长在这里就等于滚一下就找不到了。Hero 因此只留一个
 * 「逛逛风格库」——它的语义是把页面往下滚，和 Hero 一起滚走才是对的。
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
	onBrowseStyles: () => void;
}

export function GalleryHero({ projectCount, designCount, empty, onBrowseStyles }: GalleryHeroProps) {
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
		<section className="astravia-design-hero relative isolate -mx-5 mb-7 overflow-hidden px-5 pb-6 pt-7">
			<div className="astravia-design-hero-glow pointer-events-none absolute inset-0 -z-10" aria-hidden />
			<div className="astravia-design-hero-dots pointer-events-none absolute inset-0 -z-10" aria-hidden />
			{/* 插画在窄屏直接不渲染：挤到文字上会两边都难看。整幅收在 Hero 内，
			    顶端不许伸出去被裁——硬裁切线在页头交界处非常显眼 */}
			<HeroArtwork className="pointer-events-none absolute -right-4 bottom-1 -z-10 hidden h-[88%] w-auto lg:block" />

			<div className="max-w-2xl">
				<h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground">
					{t("gallery.hero.title")}
				</h1>
				<p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
					{t(empty ? "gallery.hero.subtitle.empty" : "gallery.hero.subtitle", { ext: SHARE_EXTENSION })}
				</p>

				<div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
					<button
						type="button"
						onClick={onBrowseStyles}
						className="group flex h-8 items-center gap-1.5 rounded-lg text-xs text-muted-foreground transition-colors hover:text-foreground"
					>
						{t("gallery.hero.browseStyles")}
						<svg
							viewBox="0 0 24 24"
							className="size-3 transition-transform duration-200 group-hover:translate-y-0.5"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden
						>
							<path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</button>

					{stats.length > 0 ? (
						<ul className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
							{stats.map((stat, index) => (
								<li key={stat} className="flex items-center gap-2 tabular-nums">
									{index > 0 ? (
										<span aria-hidden className="size-1 rounded-full bg-current opacity-40" />
									) : null}
									{stat}
								</li>
							))}
						</ul>
					) : null}
				</div>
			</div>
		</section>
	);
}
