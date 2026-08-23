import { useTranslation } from "@astravia-org/plugin-sdk";

/**
 * 画廊工具栏。它不渲染在插件自己的页面里，而是通过
 * `ui.setWorkspaceViewHeader` 交给宿主页头——那条栏本来就是窗口拖拽区与
 * macOS 红绿灯安全区，多叠一条插件自己的顶栏只会白占 44px 并留下一条硬边。
 *
 * 因此这里的元素必须带 `no-drag`：宿主页头整条是 `drag-region`，不摘出来的话
 * 输入框和按钮会被窗口拖拽吃掉点击。
 */

export interface GalleryToolbarLeftProps {
	/** 「全部设计」列表页会多一个返回键和计数。 */
	view: "home" | "projects";
	count: number;
	keyword: string;
	onKeywordChange: (keyword: string) => void;
	onBack: () => void;
}

export function GalleryToolbarLeft({ view, count, keyword, onKeywordChange, onBack }: GalleryToolbarLeftProps) {
	const { t } = useTranslation();
	return (
		<div className="no-drag flex min-w-0 items-center gap-2">
			{view === "projects" ? (
				<button
					type="button"
					onClick={onBack}
					aria-label={t("gallery.projects.back")}
					title={t("gallery.projects.back")}
					className="flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
						<path d="M14 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</button>
			) : null}
			<span className="shrink-0 text-sm font-semibold text-foreground">
				{view === "projects" ? t("gallery.projects.title") : t("gallery.title")}
			</span>
			{view === "projects" ? (
				<span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] text-muted-foreground">
					{t("gallery.count", { count })}
				</span>
			) : null}
			<div className="relative ml-1">
				<svg
					viewBox="0 0 24 24"
					className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
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
					className="w-52 rounded-lg border border-transparent bg-accent/60 py-1.5 pl-8 pr-2.5 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:bg-card"
				/>
			</div>
		</div>
	);
}

export interface GalleryToolbarRightProps {
	loading: boolean;
	busy: boolean;
	onRefresh: () => void;
	onImport: () => void;
	onCreate: () => void;
}

export function GalleryToolbarRight({ loading, busy, onRefresh, onImport, onCreate }: GalleryToolbarRightProps) {
	const { t } = useTranslation();
	return (
		<div className="no-drag flex items-center gap-1.5">
			<button
				type="button"
				onClick={onRefresh}
				disabled={loading}
				aria-label={t("gallery.action.refresh")}
				title={t("gallery.action.refresh")}
				className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
			>
				<svg
					viewBox="0 0 24 24"
					className={`size-3.5 ${loading ? "animate-spin" : ""}`}
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					aria-hidden
				>
					<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</button>
			<button
				type="button"
				onClick={onImport}
				disabled={busy}
				className="rounded-lg px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-40"
			>
				{t("gallery.action.import")}
			</button>
			<button
				type="button"
				onClick={onCreate}
				disabled={busy}
				className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
			>
				<svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
					<path d="M12 5v14M5 12h14" strokeLinecap="round" />
				</svg>
				{t("gallery.action.create")}
			</button>
		</div>
	);
}
