import { useTranslation } from "@astravia-org/plugin-sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../canvas/ConfirmDialog";
import { SHARE_EXTENSION, SHARE_PREVIEW_EXTENSIONS } from "../export/share-format";
import { refreshDesignCatalog } from "../design-systems/index";
import { getPluginCtx, notify } from "../plugin-context";
import { GALLERY_VIEW_ID } from "../tab-ids";
import { AllProjectsView } from "./AllProjectsView";
import { CardContextMenu, type CardMenuAnchor } from "./CardContextMenu";
import { CreateDesignDialog } from "./CreateDesignDialog";
import { DesignSystemDetailDialog } from "./DesignSystemDetailDialog";
import { DesignSystemGrid } from "./DesignSystemGrid";
import { GalleryCard } from "./GalleryCard";
import { GalleryHero } from "./GalleryHero";
import { GalleryToolbarLeft, GalleryToolbarRight } from "./GalleryToolbar";
import { SectionHeader } from "./SectionHeader";
import { hasMoreProjects, homeVisibleCount, PROJECT_GRID_CLASS } from "./gallery-layout";
import { useGalleryColumns } from "./use-gallery-columns";
import {
	archiveProject,
	type CreatedDesign,
	createDesignProject,
	exportDesignByPath,
	importDesignPackage,
	isSharePackageName,
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

	const refresh = useCallback(
		async (options?: { forceCatalog?: boolean }) => {
			setLoading(true);
			// 用户手动点「刷新」才强制拉风格库（不受 TTL 挡）；进入页面的自动刷新
			// 走 TTL + ETag（见下方 mount effect），低配机首开不再固定多扛一次
			// 300+ KB 的清单下载。
			if (options?.forceCatalog) {
				void refreshDesignCatalog(getPluginCtx(), Date.now(), { force: true });
			}
			try {
				setSnapshot(await loadGallery());
			} catch (error) {
				notify({ message: t("gallery.load.failed"), error });
			} finally {
				setLoading(false);
			}
		},
		[t],
	);

	// 进设计页扫一遍项目 + 顺带看一眼风格库有没有更新。风格库走 TTL 节流 + ETag，
	// 内容没变时只是一个 304，所以用户不需要记得点刷新。
	useEffect(() => {
		void refresh();
		void refreshDesignCatalog(getPluginCtx());
	}, [refresh]);

	/** 导完直接进项目看设计：包里已经有成品，用户刚表达的意图就是「打开它」。 */
	const enterCreated = useCallback(
		async (created: CreatedDesign) => {
			await refresh();
			await openProjectFromGallery({ cwd: created.cwd, astdPath: created.astdPath });
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
				// 新建后画廊不刷新的话，项目已落盘但列表没有新卡——用户以为没建成。
				await refresh();
			} catch (error) {
				notify({ message: t("gallery.create.failed"), error });
			} finally {
				setBusy(false);
			}
		},
		[t, refresh]
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
		[t, locale]
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
				const path = await exportDesignByPath(design.astdPath);
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
	const designCount = useMemo(() => cards.reduce((total, card) => total + card.designs.length, 0), [cards]);
	const empty = !loading && (snapshot?.cards.length ?? 0) === 0;

	/** 首页资产宫格：量出实际列数，只铺前 3 行，其余收进列表页。 */
	const { ref: homeGridRef, columns } = useGalleryColumns();
	const homeCount = homeVisibleCount(cards.length, columns);
	const overflowing = hasMoreProjects(cards.length, columns);

	const openCard = useCallback((card: GalleryCardData) => {
		void openProjectFromGallery({ cwd: card.cwd, astdPath: card.cover.astdPath });
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
	/**
	 * 页头接管。首页把工具栏长在 Hero 里（见 GalleryHero 的说明），页头因此只需要
	 * 收掉宿主标题、留作窗口拖拽区；「全部设计」列表页没有 Hero，工具栏回到页头。
	 *
	 * 刻意不写依赖数组——节点闭包着 keyword / loading / busy 等每次渲染都可能变的
	 * 状态，漏一个依赖就会让页头里的搜索框停在旧值上。写入是幂等的 store.set，
	 * 且页头不会反过来触发本组件重渲染，不存在循环。
	 */
	useEffect(() => {
		if (view !== "projects") {
			// immersive：页头浮在画廊之上，Hero 从窗口第一像素开始铺，
			// 不再被 44px 页头推出一条谁也画不了的空带。
			getPluginCtx().ui.setWorkspaceViewHeader(GALLERY_VIEW_ID, { hideTitle: true, immersive: true });
			return;
		}
		getPluginCtx().ui.setWorkspaceViewHeader(GALLERY_VIEW_ID, {
			hideTitle: true,
			left: (
				<GalleryToolbarLeft
					view={view}
					count={cards.length}
					keyword={keyword}
					onKeywordChange={setKeyword}
					onBack={() => setView("home")}
				/>
			),
			right: (
				<GalleryToolbarRight
					loading={loading}
					busy={busy}
					onRefresh={() => void refresh({ forceCatalog: true })}
					onImport={() => void onPickImport()}
					onCreate={() => setCreating(true)}
				/>
			),
		});
	});

	// 离开画廊就把页头还给宿主（否则切到别的页面还挂着已卸载组件的节点）。
	useEffect(() => () => getPluginCtx().ui.setWorkspaceViewHeader(GALLERY_VIEW_ID, null), []);

	// 首页与空态共用同一块 Hero，统计随「库里有没有东西」变。
	const hero = (
		<GalleryHero
			projectCount={cards.length}
			designCount={designCount}
			empty={empty}
			loading={loading}
			busy={busy}
			keyword={keyword}
			onKeywordChange={setKeyword}
			onRefresh={() => void refresh({ forceCatalog: true })}
			onImport={() => void onPickImport()}
			onCreate={() => setCreating(true)}
		/>
	);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: 整页都是分享包的放置区
		<div
			className="relative flex h-full w-full flex-col overflow-hidden"
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
			<div className="astd-gallery-scroll flex-1 overflow-y-auto overflow-x-hidden px-5 pb-8">
				{view === "projects" ? (
					// 全部设计：整页宫格，滚动到底部自动翻页。
					<>
						<AllProjectsView cards={cards} onOpen={openCard} onCardContextMenu={openCardMenu} />
						{cards.length === 0 ? (
							<p className="mt-8 text-center text-xs text-muted-foreground">{t("gallery.search.noMatch")}</p>
						) : null}
					</>
				) : empty ? (
					// 空态：Hero 换一句更具引导性的副标题，风格库紧随其后当首屏主角——
					// 点一套风格就能开工，比对着空白画布想第一句话快。
					<>
						{hero}
						<div>
							<DesignSystemGrid busy={busy} onPick={setDetailSystem} />
						</div>
					</>
				) : (
					<>
						{hero}
						<section>
							<SectionHeader
								title={t("gallery.section.mine")}
								badge={t("gallery.count", { count: cards.length })}
								action={
									overflowing ? (
										<button
											type="button"
											onClick={() => setView("projects")}
											className="group flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
										>
											{t("gallery.section.more")}
											<svg
												viewBox="0 0 24 24"
												className="size-3 transition-transform duration-200 group-hover:translate-x-0.5"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
												aria-hidden
											>
												<path d="M10 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
											</svg>
										</button>
									) : null
								}
							/>
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
						<div>
							<DesignSystemGrid divided busy={busy} onPick={setDetailSystem} />
						</div>
					</>
				)}
			</div>


			{menu ? (
				<CardContextMenu
					anchor={menu}
					onExport={(design) => void onExport(design)}
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
