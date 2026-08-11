import { useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../canvas/ConfirmDialog";
import { SHARE_EXTENSION, SHARE_PREVIEW_EXTENSIONS } from "../export/share-format";
import { refreshDesignCatalog } from "../design-systems/index";
import { getPluginCtx, notify } from "../plugin-context";
import { AllProjectsView } from "./AllProjectsView";
import { CardContextMenu, type CardMenuAnchor } from "./CardContextMenu";
import { CreateDesignDialog } from "./CreateDesignDialog";
import { DesignSystemDetailDialog } from "./DesignSystemDetailDialog";
import { DesignSystemGrid } from "./DesignSystemGrid";
import { GalleryCard } from "./GalleryCard";
import { hasMoreProjects, homeVisibleCount, PROJECT_GRID_CLASS } from "./gallery-layout";
import { useGalleryColumns } from "./use-gallery-columns";
import {
	archiveProject,
	type CreatedDesign,
	createDesignProject,
	exportDesignByPath,
	importDesignPackage,
	isSharePackageName,
	revealProject,
} from "./gallery-actions";
import type { DesignSystem } from "../design-systems/types";
import { filterGalleryProjects, type GalleryDesign } from "./gallery-model";
import { type GalleryCard as GalleryCardData, getCachedSnapshot, loadGallery } from "./gallery-store";
import { openProjectFromGallery, startDesignProject } from "./open-project";
import { startDesignFromSystem } from "./start-from-system";

/**
 * 设计画廊：所有「带设计稿的项目」的注册中心。
 *
 * 数据在每次进入时重扫一遍（每个项目一次 readDir，便宜），但先用上一次的缓存渲染，
 * 免得每次进来都白屏一下。自己建/导/归档后走局部更新，不重扫。
 */
export function GalleryView() {
	const { t, locale } = useTranslation();
	const [snapshot, setSnapshot] = useState(() => getCachedSnapshot());
	const [loading, setLoading] = useState(!getCachedSnapshot());
	const [keyword, setKeyword] = useState("");
	const [menu, setMenu] = useState<CardMenuAnchor | null>(null);
	const [creating, setCreating] = useState(false);
	/** 首页（≤3 行资产 + 风格库）或全部设计列表页。 */
	const [view, setView] = useState<"home" | "projects">("home");
	/** 正在看详情的风格；详情里点「使用」才进入命名流程。 */
	const [detailSystem, setDetailSystem] = useState<DesignSystem | null>(null);
	/** 已经选好、正在等用户输入项目名的风格。 */
	const [pendingSystem, setPendingSystem] = useState<DesignSystem | null>(null);
	const [busy, setBusy] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [archiveTarget, setArchiveTarget] = useState<GalleryCardData | null>(null);
	/** 右键菜单的定位基准：菜单是这个容器的 absolute 子节点。 */
	const rootRef = useRef<HTMLDivElement | null>(null);

	const refresh = useCallback(async () => {
		setLoading(true);
		// 顺带强制刷新风格库：用户点「刷新」就是要看最新的，不该被 6 小时 TTL 挡住。
		void refreshDesignCatalog(getPluginCtx(), Date.now(), { force: true });
		try {
			setSnapshot(await loadGallery());
		} catch (error) {
			notify({ message: t("gallery.load.failed"), error });
		} finally {
			setLoading(false);
		}
	}, [t]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// 进设计页就顺带看一眼风格库有没有更新。走 TTL 节流 + ETag，内容没变时只是一个
	// 304，所以用户不需要记得点刷新——推上去的新风格下次打开这页就在了。
	useEffect(() => {
		void refreshDesignCatalog(getPluginCtx());
	}, []);

	/** 导完直接进项目看设计：包里已经有成品，用户刚表达的意图就是「打开它」。 */
	const enterCreated = useCallback(
		async (created: CreatedDesign) => {
			await refresh();
			await openProjectFromGallery({ cwd: created.cwd, vetdPath: created.vetdPath });
		},
		[refresh],
	);

	/**
	 * 新建：只落一个空项目，然后把用户送到它的新建会话页，输入框里预置好设计 skill 的
	 * badge。设计本身由用户的第一句提示词交给 agent 建，建完画廊自动扫出这张卡。
	 */
	const onCreate = useCallback(
		async (name: string) => {
			setBusy(true);
			try {
				const created = await createDesignProject(name);
				setCreating(false);
				await startDesignProject(created.cwd);
			} catch (error) {
				notify({ message: t("gallery.create.failed"), error });
			} finally {
				setBusy(false);
			}
		},
		[t],
	);

	/**
	 * 从风格库开一份新设计：先问项目名（用户刚点的是风格，不是在给项目起名），
	 * 确认后才建项目、落参考资料并进新会话。
	 */
	const onCreateFromSystem = useCallback(
		async (system: DesignSystem, name: string) => {
			setBusy(true);
			try {
				await startDesignFromSystem(system, name, locale);
				setPendingSystem(null);
			} catch (error) {
				notify({ message: t("gallery.styles.failed"), error });
			} finally {
				setBusy(false);
			}
		},
		[t, locale],
	);

	const importBytes = useCallback(
		async (fileName: string, bytes: Uint8Array) => {
			setBusy(true);
			try {
				const created = await importDesignPackage(fileName, bytes);
				notify({ message: t("gallery.import.done"), variant: "success", durationMs: 3000 });
				await enterCreated(created);
			} catch (error) {
				notify({ message: t("gallery.import.failed"), error });
			} finally {
				setBusy(false);
			}
		},
		[enterCreated, t],
	);

	/** 按钮入口：走宿主的原生选择框，内容随选择一起回来（插件读不了项目外的文件）。 */
	const onPickImport = useCallback(async () => {
		try {
			const picked = await getPluginCtx().official.dialog.openFiles({
				title: t("gallery.import.title"),
				filters: [{ name: t("gallery.import.filter"), extensions: [...SHARE_PREVIEW_EXTENSIONS] }],
			});
			const file = picked[0];
			if (!file) return;
			await importBytes(file.name, Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0)));
		} catch (error) {
			notify({ message: t("gallery.import.failed"), error });
		}
	}, [importBytes, t]);

	const onDrop = useCallback(
		async (event: React.DragEvent) => {
			event.preventDefault();
			setDragging(false);
			const file = [...event.dataTransfer.files].find((candidate) => isSharePackageName(candidate.name));
			if (!file) {
				notify({ message: t("gallery.import.wrongType", { ext: SHARE_EXTENSION }) });
				return;
			}
			// 拖进来的 File 直接就能读字节，不需要任何宿主授权。
			await importBytes(file.name, new Uint8Array(await file.arrayBuffer()));
		},
		[importBytes, t],
	);

	const onExport = useCallback(
		async (design: GalleryDesign) => {
			setMenu(null);
			setBusy(true);
			notify({ message: t("gallery.export.started", { name: design.name }) });
			try {
				const path = await exportDesignByPath(design.vetdPath);
				// 用户在另存为对话框里取消：什么都没写盘，也不需要提示。
				if (path === null) return;
				notify({ message: t("gallery.export.done", { path }), variant: "success", durationMs: 4000 });
			} catch (error) {
				notify({ message: t("gallery.export.failed"), error });
			} finally {
				setBusy(false);
			}
		},
		[t],
	);

	const onArchive = useCallback(
		async (card: GalleryCardData) => {
			setArchiveTarget(null);
			try {
				await archiveProject(card.cwd);
				// 局部更新即可：归档只从列表里拿走一张卡，没必要重扫全部项目。
				setSnapshot((prev) =>
					prev ? { ...prev, cards: prev.cards.filter((item) => item.cwd !== card.cwd) } : prev,
				);
			} catch (error) {
				notify({ message: t("gallery.archive.failed"), error });
			}
		},
		[t],
	);

	// memo 不只是省一次 filter：AllProjectsView 以数组引用变化为「重置分页」的信号。
	const cards = useMemo(() => filterGalleryProjects(snapshot?.cards ?? [], keyword), [snapshot, keyword]);
	const empty = !loading && (snapshot?.cards.length ?? 0) === 0;

	/** 首页资产宫格：量出实际列数，只铺前 3 行，其余收进列表页。 */
	const { ref: homeGridRef, columns } = useGalleryColumns();
	const homeCount = homeVisibleCount(cards.length, columns);
	const overflowing = hasMoreProjects(cards.length, columns);

	const openCard = useCallback((card: GalleryCardData) => {
		void openProjectFromGallery({ cwd: card.cwd, vetdPath: card.cover.vetdPath });
	}, []);

	const openCardMenu = useCallback((event: React.MouseEvent, card: GalleryCardData) => {
		event.preventDefault();
		const box = rootRef.current?.getBoundingClientRect();
		setMenu({
			card,
			x: event.clientX - (box?.left ?? 0),
			y: event.clientY - (box?.top ?? 0),
		});
	}, []);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: 整页都是分享包的放置区
		<div
			ref={rootRef}
			className="relative flex h-full w-full flex-col overflow-hidden bg-background"
			onDragOver={(event) => {
				event.preventDefault();
				setDragging(true);
			}}
			onDragLeave={(event) => {
				// 只在真正离开整个区域时收起提示，否则掠过子元素会一直闪。
				if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
				setDragging(false);
			}}
			onDrop={onDrop}
		>
			<header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
				{view === "projects" ? (
					<button
						type="button"
						onClick={() => setView("home")}
						aria-label={t("gallery.projects.back")}
						title={t("gallery.projects.back")}
						className="flex size-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
							<path d="M14 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</button>
				) : null}
				<span className="text-sm font-semibold text-foreground">
					{view === "projects" ? t("gallery.projects.title") : t("gallery.title")}
				</span>
				{view === "projects" ? (
					<span className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-muted-foreground">
						{t("gallery.count", { count: cards.length })}
					</span>
				) : null}
				<div className="relative ml-2">
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
						onChange={(event) => setKeyword(event.target.value)}
						placeholder={t("gallery.search")}
						aria-label={t("gallery.search")}
						className="w-52 rounded-lg border border-border bg-card py-1.5 pl-8 pr-2.5 text-xs text-foreground outline-none transition-colors focus:border-primary"
					/>
				</div>
				<div className="flex-1" />
				<button
					type="button"
					onClick={() => void refresh()}
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
					onClick={() => void onPickImport()}
					disabled={busy}
					className="rounded-lg border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-40"
				>
					{t("gallery.action.import")}
				</button>
				<button
					type="button"
					onClick={() => setCreating(true)}
					disabled={busy}
					className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
				>
					<svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
						<path d="M12 5v14M5 12h14" strokeLinecap="round" />
					</svg>
					{t("gallery.action.create")}
				</button>
			</header>

			<div className="flex-1 overflow-y-auto px-4 py-4">
				{view === "projects" ? (
					// 全部设计：整页宫格，滚动到底部自动翻页。
					<>
						<AllProjectsView cards={cards} onOpen={openCard} onCardContextMenu={openCardMenu} />
						{cards.length === 0 ? (
							<p className="mt-8 text-center text-xs text-muted-foreground">{t("gallery.search.noMatch")}</p>
						) : null}
					</>
				) : empty ? (
					// 空态：风格库是首屏主角。点一套风格就能开工，比对着空白画布想第一句话快。
					<div className="flex flex-col gap-6">
						<div className="mt-2 flex flex-col items-center gap-1.5 text-center">
							<p className="text-sm font-medium text-foreground">{t("gallery.empty.title")}</p>
							<p className="max-w-96 text-xs leading-relaxed text-muted-foreground">
								{t("gallery.empty.description", { ext: SHARE_EXTENSION })}
							</p>
						</div>
						<DesignSystemGrid busy={busy} onPick={setDetailSystem} />
					</div>
				) : (
					<>
						<section>
							<header className="mb-3 flex min-w-0 items-baseline gap-2">
								<h2 className="shrink-0 text-sm font-medium text-foreground">{t("gallery.section.mine")}</h2>
								<span className="text-[11px] text-muted-foreground">
									{t("gallery.count", { count: cards.length })}
								</span>
								<div className="flex-1" />
								{overflowing ? (
									<button
										type="button"
										onClick={() => setView("projects")}
										className="flex shrink-0 items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-xs text-primary transition-colors hover:bg-accent"
									>
										{t("gallery.section.more")}
										<svg
											viewBox="0 0 24 24"
											className="size-3"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											aria-hidden
										>
											<path d="M10 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
									</button>
								) : null}
							</header>
							<div ref={homeGridRef} className={PROJECT_GRID_CLASS}>
								{cards.slice(0, homeCount).map((card) => (
									<GalleryCard
										key={card.cwd}
										card={card}
										onOpen={() => openCard(card)}
										onContextMenu={(event) => openCardMenu(event, card)}
									/>
								))}
							</div>
						</section>
						{cards.length === 0 ? (
							<p className="mt-8 text-center text-xs text-muted-foreground">{t("gallery.search.noMatch")}</p>
						) : null}

						{/* 风格库排在用户自己的作品之后，同一套宫格、跟着一起滚。 */}
						<DesignSystemGrid divided busy={busy} onPick={setDetailSystem} />
					</>
				)}
			</div>


			{menu ? (
				<CardContextMenu
					anchor={menu}
					onExport={(design) => void onExport(design)}
					onReveal={() => {
						const target = menu.card.cwd;
						setMenu(null);
						void revealProject(target).catch((error: unknown) => {
							notify({ message: t("gallery.reveal.failed"), error });
						});
					}}
					onArchive={() => {
						setArchiveTarget(menu.card);
						setMenu(null);
					}}
					onClose={() => setMenu(null)}
				/>
			) : null}

			{creating ? (
				<CreateDesignDialog
					workspacePath={snapshot?.workspacePath ?? ""}
					busy={busy}
					onCreate={(name) => void onCreate(name)}
					onClose={() => setCreating(false)}
				/>
			) : null}

			{detailSystem ? (
				<DesignSystemDetailDialog
					system={detailSystem}
					busy={busy}
					onUse={(system) => {
						// 详情的使命到此为止：收起自己，把风格交给命名对话框。
						setDetailSystem(null);
						setPendingSystem(system);
					}}
					onClose={() => setDetailSystem(null)}
				/>
			) : null}

			{pendingSystem ? (
				<CreateDesignDialog
					workspacePath={snapshot?.workspacePath ?? ""}
					busy={busy}
					styleName={pendingSystem.name}
					onCreate={(name) => void onCreateFromSystem(pendingSystem, name)}
					onClose={() => setPendingSystem(null)}
				/>
			) : null}

			{archiveTarget ? (
				<ConfirmDialog
					title={t("gallery.archive.title", { name: archiveTarget.name })}
					description={t("gallery.archive.description")}
					confirmLabel={t("gallery.archive.confirm")}
					cancelLabel={t("gallery.action.cancel")}
					danger
					onConfirm={() => void onArchive(archiveTarget)}
					onCancel={() => setArchiveTarget(null)}
				/>
			) : null}

			{dragging ? (
				<div className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/10">
					<span className="text-sm font-medium text-foreground">
						{t("gallery.import.dropHint", { ext: SHARE_EXTENSION })}
					</span>
				</div>
			) : null}
		</div>
	);
}
