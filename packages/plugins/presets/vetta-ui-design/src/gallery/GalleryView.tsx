import { useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../canvas/ConfirmDialog";
import { SHARE_EXTENSION, SHARE_PREVIEW_EXTENSIONS } from "../export/share-format";
import { refreshDesignCatalog } from "../design-systems/index";
import { getPluginCtx, notify } from "../plugin-context";
import { CardContextMenu, type CardMenuAnchor } from "./CardContextMenu";
import { CreateDesignDialog } from "./CreateDesignDialog";
import { DesignSystemGrid } from "./DesignSystemGrid";
import { GalleryCard } from "./GalleryCard";
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

	const cards = filterGalleryProjects(snapshot?.cards ?? [], keyword);
	const empty = !loading && (snapshot?.cards.length ?? 0) === 0;

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
			<header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
				<span className="text-sm font-medium text-foreground">{t("gallery.title")}</span>
				<input
					value={keyword}
					onChange={(event) => setKeyword(event.target.value)}
					placeholder={t("gallery.search")}
					aria-label={t("gallery.search")}
					className="ml-2 w-48 rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-foreground outline-none focus:border-primary"
				/>
				<div className="flex-1" />
				<button
					type="button"
					onClick={() => void refresh()}
					disabled={loading}
					className="rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40"
				>
					{t("gallery.action.refresh")}
				</button>
				<button
					type="button"
					onClick={() => void onPickImport()}
					disabled={busy}
					className="rounded-lg px-2.5 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-40"
				>
					{t("gallery.action.import")}
				</button>
				<button
					type="button"
					onClick={() => setCreating(true)}
					disabled={busy}
					className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
				>
					{t("gallery.action.create")}
				</button>
			</header>

			<div className="flex-1 overflow-y-auto px-4 py-4">
				{empty ? (
					// 空态：风格库是首屏主角。点一套风格就能开工，比对着空白画布想第一句话快。
					<div className="flex flex-col gap-5">
						<div className="flex flex-col items-center gap-1 text-center">
							<p className="text-sm text-foreground">{t("gallery.empty.title")}</p>
							<p className="max-w-96 text-xs leading-relaxed text-muted-foreground">
								{t("gallery.empty.description", { ext: SHARE_EXTENSION })}
							</p>
						</div>
						<DesignSystemGrid busy={busy} onPick={setPendingSystem} />
					</div>
				) : (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
						{cards.map((card) => (
							<GalleryCard
								key={card.cwd}
								card={card}
								onOpen={() => {
									void openProjectFromGallery({ cwd: card.cwd, vetdPath: card.cover.vetdPath });
								}}
								onContextMenu={(event) => {
									event.preventDefault();
									const box = rootRef.current?.getBoundingClientRect();
									setMenu({
										card,
										x: event.clientX - (box?.left ?? 0),
										y: event.clientY - (box?.top ?? 0),
									});
								}}
							/>
						))}
					</div>
				)}
				{!empty && cards.length === 0 ? (
					<p className="mt-8 text-center text-xs text-muted-foreground">{t("gallery.search.noMatch")}</p>
				) : null}

				{/* 已经有设计时风格库排在用户自己的作品之后，同一套宫格、跟着一起滚。 */}
				{empty ? null : <DesignSystemGrid divided busy={busy} onPick={setPendingSystem} />}
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
