import type { PluginPreviewFile } from "@vetta-org/plugin-sdk";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useState } from "react";
import { parsePackagedVetd, importPackagedVetd, type PackagedVetd } from "../export/import-design";
import { getPluginCtx, notify } from "../plugin-context";
import { setPendingDesignPath } from "../canvas/design-runtime";
import { PreviewCanvas } from "./PreviewCanvas";
import { inlineSnapshotAssets } from "./snapshot-assets";
import { CANVAS_TAB_ID } from "../tab-ids";
import { emptyManifest, type VetdManifest } from "../vetd/manifest-types";

type PreviewState =
	| { kind: "loading" }
	| { kind: "invalid" }
	| { kind: "working"; manifest: VetdManifest }
	/** `snapshotHtml` 是已经把包内资源内嵌进去的版本，见 snapshot-assets。 */
	| { kind: "packaged"; manifest: VetdManifest; packaged: PackagedVetd; snapshotHtml: string | null };

function parseManifest(json: string): VetdManifest | null {
	try {
		const parsed = JSON.parse(json) as VetdManifest;
		if (parsed && parsed.type === "vetta-design" && Array.isArray(parsed.frames)) {
			return { ...emptyManifest(), ...parsed };
		}
	} catch {
		// fallthrough
	}
	return null;
}

export function VetdPreview({ file }: { file: PluginPreviewFile }) {
	const { t } = useTranslation();
	const [state, setState] = useState<PreviewState>({ kind: "loading" });

	useEffect(() => {
		let cancelled = false;
		const load = async (): Promise<void> => {
			const url = file.getUrl();
			const bytes = url ? new Uint8Array(await (await fetch(url)).arrayBuffer()) : null;
			if (!bytes) {
				setState({ kind: "invalid" });
				return;
			}
			// zip sniff: PK\x03\x04
			if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
				const packaged = parsePackagedVetd(bytes);
				const manifest = parseManifest(packaged.manifestJson);
				if (!manifest) {
					setState({ kind: "invalid" });
					return;
				}
				// 图片在包里但快照引用的是构建产物路径（srcdoc 下解析不到），这里补上。
				const snapshotHtml = packaged.snapshotHtml
					? await inlineSnapshotAssets(packaged.snapshotHtml, packaged.designFiles)
					: null;
				if (cancelled) return;
				setState({ kind: "packaged", manifest, packaged, snapshotHtml });
				return;
			}
			const manifest = parseManifest(new TextDecoder().decode(bytes));
			setState(manifest ? { kind: "working", manifest } : { kind: "invalid" });
		};
		load().catch((error: unknown) => {
			if (cancelled) return;
			setState({ kind: "invalid" });
			notify({ message: t("preview.invalid"), error });
		});
		return () => {
			cancelled = true;
		};
	}, [file, t]);

	const openCanvas = (): void => {
		if (file.path) setPendingDesignPath(file.path);
		const ctx = getPluginCtx();
		ctx.ui.setActivityTabVisible(CANVAS_TAB_ID, true);
		ctx.ui.openActivityTab(CANVAS_TAB_ID, { width: "max" });
	};

	const runImport = async (packaged: PackagedVetd): Promise<void> => {
		try {
			const ctx = getPluginCtx();
			if (!file.path) throw new Error("no file path");
			const targetDir = file.path.slice(0, file.path.lastIndexOf("/"));
			const vetdPath = await importPackagedVetd(ctx, packaged, targetDir, file.name);
			notify({ message: t("canvas.import.done", { path: vetdPath }), variant: "success", durationMs: 5000 });
			setPendingDesignPath(vetdPath);
			ctx.ui.setActivityTabVisible(CANVAS_TAB_ID, true);
			ctx.ui.openActivityTab(CANVAS_TAB_ID, { width: "max" });
		} catch (error) {
			notify({ message: t("canvas.import.failed"), error });
		}
	};

	if (state.kind === "loading") {
		return (
			<div className="flex h-full items-center justify-center">
				<span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
			</div>
		);
	}
	if (state.kind === "invalid") {
		return (
			<div className="flex h-full items-center justify-center text-xs text-muted-foreground">
				{t("preview.invalid")}
			</div>
		);
	}

	const badge = state.kind === "packaged" ? t("preview.packaged.badge") : t("preview.working.badge");
	return (
		<div className="relative flex h-full min-h-0 flex-col gap-2 p-3">
			<div className="flex items-center gap-2">
				<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
					{badge}
				</span>
				<span className="text-xs text-muted-foreground">
					{t("preview.frames.count", { count: state.manifest.frames.length })}
				</span>
				<span className="flex-1" />
				{state.kind === "working" ? (
					<button
						type="button"
						onClick={openCanvas}
						className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
					>
						{t("preview.open")}
					</button>
				) : (
					<button
						type="button"
						onClick={() => void runImport(state.packaged)}
						className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
					>
						{t("preview.import")}
					</button>
				)}
			</div>
			{state.kind === "packaged" && !state.snapshotHtml ? (
				<p className="text-xs text-muted-foreground">{t("preview.snapshot.missing")}</p>
			) : null}
			{/* 只读画布：与设计面板同一套平移/缩放（见 canvas/use-viewport），
			    但不带选中、拖拽与编辑——分享包在预览里不可改。 */}
			<div className="min-h-0 flex-1 overflow-hidden rounded-lg">
				<PreviewCanvas
					manifest={state.manifest}
					snapshotHtml={state.kind === "packaged" ? state.snapshotHtml : null}
				/>
			</div>
		</div>
	);
}
