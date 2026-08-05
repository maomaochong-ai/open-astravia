import { useTranslation } from "@vetta-org/plugin-sdk";
import { useCallback, useEffect, useState } from "react";
import {
	applyDesignSystem,
	buildRestylePrompt,
	designMdExists,
	hasBackup,
	readAppliedSystemId,
	restoreBackup,
} from "../design-systems/apply";
import { DESIGN_SYSTEMS, designSystemById } from "../design-systems/index";
import { getPluginCtx, notify } from "../plugin-context";
import type { DesignSession } from "../vetd/design-session";
import { ConfirmDialog } from "./ConfirmDialog";
import { DesignSystemPreview } from "./DesignSystemPreview";

interface DesignSystemDrawerProps {
	session: DesignSession;
	open: boolean;
	onClose(): void;
}

/** 待二次确认的应用/还原动作。 */
type PendingAction =
	| { kind: "restyle"; systemId: string; frameCount: number }
	| { kind: "overwrite"; systemId: string }
	| { kind: "restore" };

/**
 * 底部设计体系抽屉：横向滚动的体系卡片（模板 UI 缩略预览），点卡选中、再点
 * 「应用」执行。零 frame 直写 theme.css + DESIGN.md；有 frame 先确认，落
 * DESIGN.md 后交给 Vetta 按规范全量重设（应用前自动整包备份，可一键还原）。
 */
export function DesignSystemDrawer({ session, open, onClose }: DesignSystemDrawerProps) {
	const { t } = useTranslation();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [appliedId, setAppliedId] = useState<string | null>(null);
	const [backupAvailable, setBackupAvailable] = useState(false);
	const [busy, setBusy] = useState(false);
	const [pending, setPending] = useState<PendingAction | null>(null);

	/** 打开时同步「当前已应用体系」（DESIGN.md frontmatter）与备份可用性。 */
	const reloadStatus = useCallback((): void => {
		const ctx = getPluginCtx();
		void readAppliedSystemId(ctx.fs, session.dirPath).then(setAppliedId);
		void hasBackup(ctx.fs, session.dirPath).then(setBackupAvailable);
	}, [session]);

	useEffect(() => {
		if (!open) return;
		reloadStatus();
	}, [open, reloadStatus]);

	// Esc 关抽屉。捕获阶段拦下来，别让画布层把它当「清空选中」消费。
	useEffect(() => {
		if (!open || pending) return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			onClose();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [open, pending, onClose]);

	const doApply = useCallback(
		(systemId: string): void => {
			const system = designSystemById(systemId);
			if (!system || busy) return;
			setBusy(true);
			setPending(null);
			void (async () => {
				try {
					const ctx = getPluginCtx();
					const result = await applyDesignSystem(ctx.fs, session.vetdPath, systemId);
					if (result.mode === "restyle") {
						// sendPrompt 要整轮跑完才 resolve，不 await；发送失败单独报。
						void ctx.conversation.sendPrompt(buildRestylePrompt(system, result, ctx.i18n.locale)).catch(
							(error: unknown) => {
								notify({ message: t("ds.apply.failed"), error });
							},
						);
						notify({
							message: t("ds.apply.restyle.sent", { name: system.name, count: result.frames.length }),
							variant: "success",
							durationMs: 4000,
						});
					} else {
						notify({
							message: t("ds.apply.direct.done", { name: system.name }),
							variant: "success",
							durationMs: 3000,
						});
					}
					setAppliedId(systemId);
					setBackupAvailable(true);
					onClose();
				} catch (error) {
					notify({ message: t("ds.apply.failed"), error });
				} finally {
					setBusy(false);
				}
			})();
		},
		[busy, session, t, onClose],
	);

	/** 「应用」入口：有 frame → 全量重设确认；零 frame 但已有 DESIGN.md → 覆盖确认。 */
	const requestApply = useCallback(
		(systemId: string): void => {
			if (busy) return;
			const frameCount = session.manifest.frames.length;
			if (frameCount > 0) {
				setPending({ kind: "restyle", systemId, frameCount });
				return;
			}
			void designMdExists(getPluginCtx().fs, session.dirPath).then((exists) => {
				if (exists) setPending({ kind: "overwrite", systemId });
				else doApply(systemId);
			});
		},
		[busy, session, doApply],
	);

	const doRestore = useCallback((): void => {
		if (busy) return;
		setBusy(true);
		setPending(null);
		void (async () => {
			try {
				await restoreBackup(getPluginCtx().fs, session.dirPath);
				notify({ message: t("ds.restore.done"), variant: "success", durationMs: 3000 });
				reloadStatus();
			} catch (error) {
				notify({ message: t("ds.restore.failed"), error });
			} finally {
				setBusy(false);
			}
		})();
	}, [busy, session, t, reloadStatus]);

	const selected = selectedId ? designSystemById(selectedId) : undefined;
	const pendingSystem =
		pending && pending.kind !== "restore" ? designSystemById(pending.systemId) : undefined;

	return (
		<>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: swallow canvas gestures under the drawer */}
			<div
				className={`absolute inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl border border-b-0 border-border bg-card/95 shadow-2xl backdrop-blur transition-transform duration-300 ease-out ${
					open ? "translate-y-0" : "pointer-events-none translate-y-full"
				}`}
				style={{ height: "min(46%, 380px)", minHeight: 300 }}
				aria-hidden={!open}
				onPointerDown={(event) => event.stopPropagation()}
				onPointerMove={(event) => event.stopPropagation()}
				onPointerUp={(event) => event.stopPropagation()}
				onWheel={(event) => event.stopPropagation()}
			>
				<div className="flex shrink-0 items-center gap-3 px-5 pb-2 pt-4">
					<div className="min-w-0">
						<div className="text-sm font-semibold text-foreground">{t("ds.title")}</div>
						<div className="truncate text-xs text-muted-foreground">
							{appliedId && designSystemById(appliedId)
								? t("ds.applied.current", { name: designSystemById(appliedId)?.name ?? appliedId })
								: t("ds.subtitle")}
						</div>
					</div>
					<div className="flex-1" />
					{backupAvailable ? (
						<button
							type="button"
							disabled={busy}
							onClick={() => setPending({ kind: "restore" })}
							className="rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
						>
							{t("ds.restore")}
						</button>
					) : null}
					<button
						type="button"
						disabled={!selected || busy}
						onClick={() => selectedId && requestApply(selectedId)}
						className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
					>
						{busy ? (
							<span className="size-3 animate-spin rounded-full border-[1.5px] border-primary-foreground/40 border-t-primary-foreground" />
						) : null}
						{selected ? t("ds.apply.named", { name: selected.name }) : t("ds.apply")}
					</button>
					<button
						type="button"
						title={t("ds.close")}
						aria-label={t("ds.close")}
						onClick={onClose}
						className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
							<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
						</svg>
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-5 pb-4 pt-1">
					<div className="flex h-full items-stretch gap-3">
						{DESIGN_SYSTEMS.map((system) => {
							const isSelected = selectedId === system.id;
							const isApplied = appliedId === system.id;
							return (
								<button
									key={system.id}
									type="button"
									onClick={() => setSelectedId(isSelected ? null : system.id)}
									onDoubleClick={() => requestApply(system.id)}
									className={`flex w-60 shrink-0 flex-col gap-2 rounded-xl border p-2.5 text-left transition-colors ${
										isSelected
											? "border-primary bg-primary/5 ring-1 ring-primary"
											: "border-border hover:border-muted-foreground/40 hover:bg-accent/40"
									}`}
								>
									<DesignSystemPreview system={system} />
									<div className="flex min-w-0 items-center gap-1.5 px-0.5">
										<span
											title={t(system.vibe === "dark" ? "ds.vibe.dark" : "ds.vibe.light")}
											className={`size-2 shrink-0 rounded-full border ${
												system.vibe === "dark"
													? "border-zinc-500 bg-zinc-900"
													: "border-zinc-300 bg-zinc-50"
											}`}
										/>
										<span className="truncate text-xs font-semibold text-foreground">{system.name}</span>
										{isApplied ? (
											<span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
												{t("ds.applied.badge")}
											</span>
										) : null}
										<span className="flex-1" />
										<span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] text-muted-foreground">
											{t(`ds.category.${system.category}`)}
										</span>
									</div>
									<div className="truncate px-0.5 text-[11px] leading-tight text-muted-foreground">
										{t(`ds.tagline.${system.id}`)}
									</div>
								</button>
							);
						})}
					</div>
				</div>
			</div>

			{pending?.kind === "restyle" && pendingSystem ? (
				<ConfirmDialog
					title={t("ds.confirm.restyle.title", { name: pendingSystem.name })}
					description={t("ds.confirm.restyle.desc", { count: pending.frameCount })}
					confirmLabel={t("ds.confirm.apply")}
					cancelLabel={t("ds.confirm.cancel")}
					onConfirm={() => doApply(pendingSystem.id)}
					onCancel={() => setPending(null)}
				/>
			) : null}
			{pending?.kind === "overwrite" && pendingSystem ? (
				<ConfirmDialog
					title={t("ds.confirm.overwrite.title")}
					description={t("ds.confirm.overwrite.desc", { name: pendingSystem.name })}
					confirmLabel={t("ds.confirm.apply")}
					cancelLabel={t("ds.confirm.cancel")}
					onConfirm={() => doApply(pendingSystem.id)}
					onCancel={() => setPending(null)}
				/>
			) : null}
			{pending?.kind === "restore" ? (
				<ConfirmDialog
					title={t("ds.confirm.restore.title")}
					description={t("ds.confirm.restore.desc")}
					confirmLabel={t("ds.confirm.restore.confirm")}
					cancelLabel={t("ds.confirm.cancel")}
					danger
					onConfirm={doRestore}
					onCancel={() => setPending(null)}
				/>
			) : null}
		</>
	);
}
