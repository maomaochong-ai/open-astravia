import type { PluginPreviewFile } from "@vetta-org/plugin-sdk";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { parsePackagedVetd, importPackagedVetd, type PackagedVetd } from "../export/import-design";
import { getPluginCtx, notify } from "../plugin-context";
import { setPendingDesignPath } from "../canvas/design-runtime";
import { CANVAS_TAB_ID } from "../tab-ids";
import { emptyManifest, type VetdManifest } from "../vetd/manifest-types";

type PreviewState =
	| { kind: "loading" }
	| { kind: "invalid" }
	| { kind: "working"; manifest: VetdManifest }
	| { kind: "packaged"; manifest: VetdManifest; packaged: PackagedVetd };

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

/** Read-only mini canvas: frames laid out to manifest positions, fit to width. */
function MiniCanvas({
	manifest,
	renderFrame,
}: {
	manifest: VetdManifest;
	renderFrame: (frameId: string, scale: number) => JSX.Element;
}) {
	const bounds = useMemo(() => {
		if (manifest.frames.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
		const minX = Math.min(...manifest.frames.map((frame) => frame.x));
		const minY = Math.min(...manifest.frames.map((frame) => frame.y));
		const maxX = Math.max(...manifest.frames.map((frame) => frame.x + frame.width));
		const maxY = Math.max(...manifest.frames.map((frame) => frame.y + frame.height));
		return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
	}, [manifest.frames]);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [containerWidth, setContainerWidth] = useState(0);
	useEffect(() => {
		const element = containerRef.current;
		if (!element) return;
		const observer = new ResizeObserver(() => setContainerWidth(element.clientWidth));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const scale = containerWidth > 0 ? Math.min((containerWidth - 24) / bounds.width, 0.5) : 0.1;
	return (
		<div ref={containerRef} className="relative w-full overflow-auto rounded-lg vetd-canvas-bg p-3">
			<div className="relative" style={{ width: bounds.width * scale, height: bounds.height * scale }}>
				{manifest.frames.map((frame) => (
					<div
						key={frame.id}
						className="absolute overflow-hidden rounded-sm bg-white shadow ring-1 ring-black/10"
						style={{
							left: (frame.x - bounds.x) * scale,
							top: (frame.y - bounds.y) * scale,
							width: frame.width * scale,
							height: frame.height * scale,
						}}
						title={`${frame.title || frame.id} · ${frame.width}×${frame.height}`}
					>
						{renderFrame(frame.id, scale)}
					</div>
				))}
			</div>
		</div>
	);
}

/** Packaged snapshot frame: the inlined single-file build rendered via srcdoc + show-frame message. */
function SnapshotFrame({ html, frameId, scale }: { html: string; frameId: string; scale: number }) {
	const ref = useRef<HTMLIFrameElement | null>(null);
	return (
		<iframe
			ref={ref}
			title={frameId}
			srcDoc={html}
			sandbox="allow-scripts"
			className="origin-top-left border-0"
			style={{ width: `${100 / scale}%`, height: `${100 / scale}%`, transform: `scale(${scale})` }}
			onLoad={() => {
				ref.current?.contentWindow?.postMessage({ vetd: true, type: "show-frame", id: frameId }, "*");
			}}
		/>
	);
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
				setState(manifest ? { kind: "packaged", manifest, packaged } : { kind: "invalid" });
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
				<span className="size-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
			</div>
		);
	}
	if (state.kind === "invalid") {
		return (
			<div className="flex h-full items-center justify-center text-xs text-neutral-400">
				{t("preview.invalid")}
			</div>
		);
	}

	const badge = state.kind === "packaged" ? t("preview.packaged.badge") : t("preview.working.badge");
	return (
		<div className="relative flex h-full flex-col gap-2 overflow-auto p-3">
			<div className="flex items-center gap-2">
				<span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-500">
					{badge}
				</span>
				<span className="text-xs text-neutral-500">
					{t("preview.frames.count", { count: state.manifest.frames.length })}
				</span>
				<span className="flex-1" />
				{state.kind === "working" ? (
					<button
						type="button"
						onClick={openCanvas}
						className="rounded-md bg-indigo-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-600"
					>
						{t("preview.open")}
					</button>
				) : (
					<button
						type="button"
						onClick={() => void runImport(state.packaged)}
						className="rounded-md bg-indigo-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-600"
					>
						{t("preview.import")}
					</button>
				)}
			</div>
			{state.kind === "packaged" && !state.packaged.snapshotHtml ? (
				<p className="text-xs text-neutral-400">{t("preview.snapshot.missing")}</p>
			) : null}
			<MiniCanvas
				manifest={state.manifest}
				renderFrame={(frameId, scale) => {
					if (state.kind === "packaged" && state.packaged.snapshotHtml) {
						return <SnapshotFrame html={state.packaged.snapshotHtml} frameId={frameId} scale={scale} />;
					}
					return (
						<div className="flex h-full items-center justify-center text-[9px] text-neutral-400">
							{frameId}
						</div>
					);
				}}
			/>
		</div>
	);
}
