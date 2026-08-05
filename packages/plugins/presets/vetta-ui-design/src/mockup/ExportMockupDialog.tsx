import { useTranslation } from "@vetta-org/plugin-sdk";
import { zipSync } from "fflate";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type MockupExportRequest, onMockupExport, requestMockupExport } from "../canvas/design-runtime";
import { parseThemeTokens } from "../canvas/theme-tokens";
import { getPluginCtx, notify } from "../plugin-context";
import { bytesToBase64, dataUrlToBytes } from "./binary";
import { VETTA_LOGO_DATA_URL } from "./brand-logo";
import { layoutMockup } from "./layout";
import { loadImage } from "./load-image";
import { MockupOptionsPanel } from "./MockupOptionsPanel";
import { MockupPreview } from "./MockupPreview";
import { defaultOptions, loadOptions, saveOptions } from "./options";
import { buildImagePdf, type PdfPageImage } from "./pdf";
import { canvasToJpegDataUrl, renderMockupToCanvas } from "./render";
import type { MockupOptions, MockupShot } from "./types";

type ExportFormat = "png" | "pdf";

/** Frames per exported image; the rest spill onto further pages. */
const PAGE_SIZE = 4;
/** Capture ratio used for the on-screen preview; export re-captures per shot. */
const PREVIEW_PIXEL_RATIO = 2;
const MAX_PIXEL_RATIO = 4;

interface ShotEntry extends MockupShot {
	error: string | null;
}

/**
 * The export dialog, mounted in the host's global slot so it can cover the whole
 * window — the design canvas lives in the activity panel, which is far too
 * narrow to judge radius and border on four side-by-side frames.
 *
 * Rendered permanently by the plugin host; it draws nothing until the canvas
 * publishes a request through design-runtime.
 */
export function ExportMockupDialog() {
	const { t } = useTranslation();
	const [request, setRequest] = useState<MockupExportRequest | null>(null);
	const [shots, setShots] = useState<ShotEntry[]>([]);
	const [options, setOptions] = useState<MockupOptions | null>(null);
	const [format, setFormat] = useState<ExportFormat>("png");
	const [busy, setBusy] = useState<"save" | "copy" | null>(null);
	const [palette, setPalette] = useState<string[]>([]);
	const [logo, setLogo] = useState<HTMLImageElement | null>(null);
	const requestRef = useRef<MockupExportRequest | null>(null);
	requestRef.current = request;

	useEffect(() => onMockupExport(setRequest), []);

	useEffect(() => {
		let cancelled = false;
		void loadImage(VETTA_LOGO_DATA_URL).then((image) => {
			if (!cancelled) setLogo(image);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const close = useCallback(() => requestMockupExport(null), []);

	/** Capture one frame and slot its bitmap in, keeping the layout stable. */
	const captureInto = useCallback(async (frameId: string): Promise<void> => {
		const active = requestRef.current;
		if (!active) return;
		setShots((current) =>
			current.map((shot) => (shot.frameId === frameId ? { ...shot, error: null, image: null } : shot)),
		);
		try {
			const dataUrl = await active.capture(frameId, PREVIEW_PIXEL_RATIO);
			const image = await loadImage(dataUrl);
			if (requestRef.current !== active) return;
			setShots((current) => current.map((shot) => (shot.frameId === frameId ? { ...shot, image } : shot)));
		} catch (error) {
			if (requestRef.current !== active) return;
			const message = error instanceof Error ? error.message : String(error);
			setShots((current) => current.map((shot) => (shot.frameId === frameId ? { ...shot, error: message } : shot)));
		}
	}, []);

	// New request: seed the shot list from the manifest, then capture in parallel.
	useEffect(() => {
		if (!request) {
			setShots([]);
			setOptions(null);
			return;
		}
		const frames = request.frameIds
			.map((frameId) => request.session.manifest.frames.find((frame) => frame.id === frameId))
			.filter((frame): frame is NonNullable<typeof frame> => frame !== undefined);
		setShots(
			frames.map((frame) => ({
				frameId: frame.id,
				title: frame.title || frame.id,
				cssWidth: frame.width,
				cssHeight: frame.height,
				image: null,
				error: null,
			})),
		);
		const normalizedHeight = Math.max(1, ...frames.map((frame) => frame.height));
		setOptions(loadOptions(request.session.vetdPath, normalizedHeight));
		void request.session
			.readThemeCss()
			.then((css) => setPalette(parseThemeTokens(css).map((token) => token.value)))
			.catch(() => setPalette([]));
		for (const frame of frames) void captureInto(frame.id);
	}, [request, captureInto]);

	useEffect(() => {
		if (!request || !options) return;
		saveOptions(request.session.vetdPath, options);
	}, [request, options]);

	useEffect(() => {
		if (!request) return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			close();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [request, close]);

	const pages = useMemo(() => {
		const chunks: ShotEntry[][] = [];
		for (let index = 0; index < shots.length; index += PAGE_SIZE) {
			chunks.push(shots.slice(index, index + PAGE_SIZE));
		}
		return chunks;
	}, [shots]);

	const errors = useMemo(() => {
		const map = new Map<string, string>();
		for (const shot of shots) if (shot.error) map.set(shot.frameId, shot.error);
		return map;
	}, [shots]);
	const pending = shots.some((shot) => !shot.image && !shot.error);
	const ready = shots.length > 0 && !pending && errors.size === 0;

	const normalizedHeight = shots.length > 0 ? Math.max(...shots.map((shot) => shot.cssHeight)) : 0;

	/**
	 * Re-capture one page at the ratio the final image actually needs, so text
	 * stays crisp instead of being upscaled from the 2x preview bitmap.
	 */
	const composePage = async (pageShots: ShotEntry[], current: MockupOptions): Promise<HTMLCanvasElement> => {
		const active = requestRef.current;
		if (!active) throw new Error("export request went away");
		const layout = layoutMockup(pageShots, current);
		const pageHeight = Math.max(...pageShots.map((shot) => shot.cssHeight));
		const fresh: MockupShot[] = [];
		for (const shot of pageShots) {
			const needed = (pageHeight / shot.cssHeight) * current.scale * layout.fit;
			const ratio = Math.min(MAX_PIXEL_RATIO, Math.max(1, needed));
			const dataUrl = await active.capture(shot.frameId, ratio);
			fresh.push({ ...shot, image: await loadImage(dataUrl) });
		}
		return renderMockupToCanvas(fresh, current, logo);
	};

	const baseName = (): string => `${requestRef.current?.session.name ?? "design"}-mockup`;

	/** One image per page; multi-page PNG ships as a zip so the user picks a path once. */
	const savePng = async (current: MockupOptions): Promise<string | null> => {
		const fs = getPluginCtx().fs;
		if (pages.length === 1) {
			const dataUrl = (await composePage(pages[0], current)).toDataURL("image/png");
			return fs.saveAs(`${baseName()}.png`, dataUrl.split(",")[1] ?? "", "base64", {
				title: t("mockup.save.title"),
				filters: [{ name: "PNG", extensions: ["png"] }],
			});
		}
		const files: Record<string, Uint8Array> = {};
		for (const [index, pageShots] of pages.entries()) {
			const dataUrl = (await composePage(pageShots, current)).toDataURL("image/png");
			files[`${baseName()}-${index + 1}.png`] = dataUrlToBytes(dataUrl);
		}
		// level 0: PNG is already deflated, re-compressing only costs time.
		const zipped = zipSync(files, { level: 0 });
		return fs.saveAs(`${baseName()}.zip`, bytesToBase64(zipped), "base64", {
			title: t("mockup.save.title"),
			filters: [{ name: "ZIP", extensions: ["zip"] }],
		});
	};

	/** Uniform page width (the widest page); the badge rides the cover only. */
	const savePdf = async (current: MockupOptions): Promise<string | null> => {
		const rendered: PdfPageImage[] = [];
		for (const [index, pageShots] of pages.entries()) {
			const canvas = await composePage(pageShots, index === 0 ? current : { ...current, brand: false });
			rendered.push({
				jpeg: dataUrlToBytes(canvasToJpegDataUrl(canvas)),
				width: canvas.width,
				height: canvas.height,
			});
		}
		const pageWidth = Math.max(...rendered.map((page) => page.width)) / current.scale;
		const pdf = buildImagePdf(rendered, pageWidth);
		return getPluginCtx().fs.saveAs(`${baseName()}.pdf`, bytesToBase64(pdf), "base64", {
			title: t("mockup.save.title"),
			filters: [{ name: "PDF", extensions: ["pdf"] }],
		});
	};

	const runSave = async (): Promise<void> => {
		if (!options || busy || !ready) return;
		setBusy("save");
		try {
			const saved = format === "pdf" ? await savePdf(options) : await savePng(options);
			if (saved) notify({ message: t("mockup.save.done", { path: saved }), variant: "success", durationMs: 5000 });
		} catch (error) {
			notify({ message: t("mockup.save.failed"), error });
		} finally {
			setBusy(null);
		}
	};

	const runCopy = async (): Promise<void> => {
		if (!options || busy || !ready || pages.length !== 1) return;
		setBusy("copy");
		try {
			const canvas = await composePage(pages[0], options);
			await getPluginCtx().ui.copyImage(canvas.toDataURL("image/png"));
			notify({ message: t("mockup.copy.done"), variant: "success", durationMs: 3000 });
		} catch (error) {
			notify({ message: t("mockup.copy.failed"), error });
		} finally {
			setBusy(null);
		}
	};

	/** Reordering works on the whole sequence; pages are just a view of it. */
	const swap = (pageIndex: number, fromIndexOnPage: number, toIndexOnPage: number): void => {
		const offset = pageIndex * PAGE_SIZE;
		setShots((current) => {
			const next = [...current];
			const from = offset + fromIndexOnPage;
			const to = offset + toIndexOnPage;
			[next[from], next[to]] = [next[to], next[from]];
			return next;
		});
	};

	if (!request || !options) return null;

	return (
		// 顶部留出宿主标题栏（TitleBar 是 h-9）的高度：macOS 红绿灯就在那条带里，
		// 模态和它的遮罩都不能盖住，否则点窗口按钮会变成关弹窗。
		<div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/55 px-6 pb-6 pt-11">
			{/* biome-ignore lint/a11y/noStaticElementInteractions: click-outside backdrop */}
			<div className="absolute inset-x-0 bottom-0 top-9" onClick={close} />
			<div className="relative flex h-[85vh] w-[90vw] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
				<div className="flex items-center gap-2 border-b border-border px-4 py-3">
					<span className="text-sm font-medium text-foreground">{t("mockup.title")}</span>
					<span className="text-xs text-muted-foreground">
						{t("mockup.subtitle", { count: shots.length })}
					</span>
					<div className="flex-1" />
					<button
						type="button"
						onClick={close}
						aria-label={t("mockup.close")}
						className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-accent"
					>
						✕
					</button>
				</div>

				<div className="flex min-h-0 flex-1">
					<div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
						{pages.map((pageShots, index) => (
							<div key={pageShots[0]?.frameId ?? index} className="flex flex-col gap-1.5">
								{pages.length > 1 ? (
									<span className="text-[11px] tabular-nums text-muted-foreground">
										{t("mockup.page.index", { index: index + 1, total: pages.length })}
									</span>
								) : null}
								<MockupPreview
									shots={pageShots}
									options={options}
									brandLogo={logo}
									errors={errors}
									onRetry={(frameId) => void captureInto(frameId)}
									onSwap={(from, to) => swap(index, from, to)}
								/>
							</div>
						))}
					</div>

					<MockupOptionsPanel
						options={options}
						maxRadius={normalizedHeight / 2}
						palette={palette}
						onChange={(patch) => setOptions((current) => (current ? { ...current, ...patch } : current))}
						onReset={() => setOptions(defaultOptions(normalizedHeight))}
					/>
				</div>

				<div className="flex items-center gap-2 border-t border-border px-4 py-3">
					<span className="text-xs text-muted-foreground">
						{pending
							? t("mockup.status.capturing")
							: errors.size > 0
								? t("mockup.status.failed", { count: errors.size })
								: t("mockup.status.pages", { count: pages.length })}
					</span>
					<div className="flex-1" />
					<div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
						{(["png", "pdf"] as const).map((value) => (
							<button
								key={value}
								type="button"
								onClick={() => setFormat(value)}
								className={`rounded-md px-2.5 py-1 text-xs font-medium uppercase transition-colors ${
									format === value
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:bg-accent"
								}`}
							>
								{value}
							</button>
						))}
					</div>
					<button
						type="button"
						disabled={!ready || busy !== null || pages.length !== 1}
						title={pages.length !== 1 ? t("mockup.copy.singleOnly") : undefined}
						onClick={() => void runCopy()}
						className="rounded-lg px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-40"
					>
						{busy === "copy" ? t("mockup.copy.running") : t("mockup.copy")}
					</button>
					<button
						type="button"
						disabled={!ready || busy !== null}
						onClick={() => void runSave()}
						className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
					>
						{busy === "save" ? t("mockup.save.running") : t("mockup.save")}
					</button>
				</div>
			</div>
		</div>
	);
}
