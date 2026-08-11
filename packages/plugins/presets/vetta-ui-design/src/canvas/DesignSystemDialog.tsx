import { useTranslation } from "@vetta-org/plugin-sdk";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { TemplateGalleryDialog } from "../cards/TemplateGalleryDialog";
import {
	applyDesignSystem,
	buildRestylePrompt,
	designMdExists,
	hasBackup,
	readAppliedSystemId,
	restoreBackup,
} from "../design-systems/apply";
import { designSystemById } from "../design-systems/index";
import { getPluginCtx, notify } from "../plugin-context";
import { PluginPortal } from "../plugin-portal";
import type { DesignSession } from "../vetd/design-session";
import { ConfirmDialog } from "./ConfirmDialog";

interface DesignSystemDialogProps {
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
 * 二次确认框套一层 portal：宫格 Dialog 是 body 上的 fixed 层，画布内 absolute 的
 * ConfirmDialog 会被它整个盖住。z 比宫格高一档。
 */
function ConfirmLayer({ children }: { children: ReactNode }) {
	return (
		<PluginPortal>
			<div className="fixed inset-0 z-[1010]">{children}</div>
		</PluginPortal>
	);
}

/**
 * 画布工具栏的「设计资源」入口：直接复用会话里那张选择卡的模板 Dialog（宫格 +
 * 底部应用），只是多接了画布侧的执行链路——零 frame 直写 theme.css + DESIGN.md；
 * 有 frame 先确认，落 DESIGN.md 后交给 Vetta 按规范全量重设（应用前自动整包备份，
 * 可一键还原）。
 */
export function DesignSystemDialog({ session, open, onClose }: DesignSystemDialogProps) {
	const { t } = useTranslation();
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

	if (!open) return null;

	const pendingSystem = pending && pending.kind !== "restore" ? designSystemById(pending.systemId) : undefined;

	return (
		<>
			<TemplateGalleryDialog
				appliedId={appliedId}
				busy={busy}
				escDisabled={pending !== null}
				headerActions={
					backupAvailable ? (
						<button
							type="button"
							disabled={busy}
							onClick={() => setPending({ kind: "restore" })}
							className="rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
						>
							{t("ds.restore")}
						</button>
					) : undefined
				}
				onApply={(systemId) => requestApply(systemId)}
				onClose={onClose}
			/>

			{pending?.kind === "restyle" && pendingSystem ? (
				<ConfirmLayer>
					<ConfirmDialog
						title={t("ds.confirm.restyle.title", { name: pendingSystem.name })}
						description={t("ds.confirm.restyle.desc", { count: pending.frameCount })}
						confirmLabel={t("ds.confirm.apply")}
						cancelLabel={t("ds.confirm.cancel")}
						onConfirm={() => doApply(pendingSystem.id)}
						onCancel={() => setPending(null)}
					/>
				</ConfirmLayer>
			) : null}
			{pending?.kind === "overwrite" && pendingSystem ? (
				<ConfirmLayer>
					<ConfirmDialog
						title={t("ds.confirm.overwrite.title")}
						description={t("ds.confirm.overwrite.desc", { name: pendingSystem.name })}
						confirmLabel={t("ds.confirm.apply")}
						cancelLabel={t("ds.confirm.cancel")}
						onConfirm={() => doApply(pendingSystem.id)}
						onCancel={() => setPending(null)}
					/>
				</ConfirmLayer>
			) : null}
			{pending?.kind === "restore" ? (
				<ConfirmLayer>
					<ConfirmDialog
						title={t("ds.confirm.restore.title")}
						description={t("ds.confirm.restore.desc")}
						confirmLabel={t("ds.confirm.restore.confirm")}
						cancelLabel={t("ds.confirm.cancel")}
						danger
						onConfirm={doRestore}
						onCancel={() => setPending(null)}
					/>
				</ConfirmLayer>
			) : null}
		</>
	);
}
