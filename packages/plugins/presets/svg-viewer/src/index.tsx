import { definePlugin, type PluginFilePreviewProps, useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { useEffect, useMemo, useState } from "react";
import "./style.css";

type LoadState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "loaded"; text: string };

const CHECKERBOARD: React.CSSProperties = {
	backgroundColor: "var(--muted)",
	backgroundImage:
		"linear-gradient(45deg, color-mix(in srgb, var(--foreground) 8%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--foreground) 8%, transparent) 75%), linear-gradient(45deg, color-mix(in srgb, var(--foreground) 8%, transparent) 25%, transparent 25%, transparent 75%, color-mix(in srgb, var(--foreground) 8%, transparent) 75%)",
	backgroundSize: "20px 20px",
	backgroundPosition: "0 0, 10px 10px",
};

function formatBytes(bytes: number): string {
	if (!bytes) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function SvgPreview({ file }: PluginFilePreviewProps) {
	const { t } = useTranslation();
	const [state, setState] = useState<LoadState>({ status: "loading" });
	const [mode, setMode] = useState<"preview" | "source">("preview");
	const [zoom, setZoom] = useState(1);

	useEffect(() => {
		let cancelled = false;

		const load = (initial: boolean) => {
			if (initial) setState({ status: "loading" });
			file
				.readText()
				.then((text) => {
					if (!cancelled) setState({ status: "loaded", text });
				})
				.catch(() => {
					if (!cancelled) setState({ status: "error", message: t("error.read") });
				});
		};

		load(true);
		// Live-update: re-read whenever the file changes on disk.
		const watcher = file.watch(() => load(false));

		return () => {
			cancelled = true;
			watcher.dispose();
		};
	}, [file]);

	const dataUrl = useMemo(() => {
		if (state.status !== "loaded") return "";
		return `data:image/svg+xml;utf8,${encodeURIComponent(state.text)}`;
	}, [state]);

	const tab =
		"cursor-pointer rounded-[7px] px-[10px] py-[4px] text-[12px] font-semibold transition-colors";
	const tabActive = "bg-[var(--background)] text-[var(--foreground)] shadow-[var(--shadow-sm)]";
	const tabIdle = "text-[var(--muted-foreground)] hover:text-[var(--foreground)]";

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col bg-[var(--background)] font-[var(--font-sans)]">
			<div className="flex shrink-0 items-center gap-[8px] border-b border-[color-mix(in_srgb,var(--border)_50%,transparent)] px-[10px] py-[7px]">
				{/* Segmented control: no host primitive — keep lightweight native tabs */}
				<div className="flex items-center gap-[2px] rounded-[9px] bg-[var(--muted)] p-[2px]">
					<button
						type="button"
						className={`${tab} ${mode === "preview" ? tabActive : tabIdle}`}
						onClick={() => setMode("preview")}
					>
						{t("tab.rendered")}
					</button>
					<button
						type="button"
						className={`${tab} ${mode === "source" ? tabActive : tabIdle}`}
						onClick={() => setMode("source")}
					>
						{t("tab.source")}
					</button>
				</div>

				{mode === "preview" && (
					<div className="flex items-center gap-[2px]">
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							title={t("action.zoomOut")}
							onClick={() => setZoom((z) => Math.max(0.1, +(z - 0.25).toFixed(2)))}
						>
							−
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="xs"
							className="min-w-[44px] tabular-nums"
							title={t("action.resetZoom")}
							onClick={() => setZoom(1)}
						>
							{Math.round(zoom * 100)}%
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							title={t("action.zoomIn")}
							onClick={() => setZoom((z) => Math.min(8, +(z + 0.25).toFixed(2)))}
						>
							+
						</Button>
					</div>
				)}

				<div className="ml-auto flex items-center gap-[8px] text-[11px] text-[var(--muted-foreground)]">
					<span className="rounded-full bg-[var(--muted)] px-[7px] py-[2px] font-bold tracking-wider uppercase">
						svg
					</span>
					{file.size > 0 && <span className="tabular-nums">{formatBytes(file.size)}</span>}
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-hidden">
				{state.status === "loading" && (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--muted-foreground)]">
						{t("state.loading")}
					</div>
				)}
				{state.status === "error" && (
					<div className="flex h-full items-center justify-center text-[13px] text-[var(--destructive)]">
						{state.message}
					</div>
				)}
				{state.status === "loaded" &&
					(mode === "preview" ? (
						<div className="flex h-full w-full items-center justify-center overflow-auto p-[20px]" style={CHECKERBOARD}>
							<img
								src={dataUrl}
								alt={file.name}
								className="max-w-none select-none"
								style={{ width: `${zoom * 100}%`, height: "auto" }}
								draggable={false}
							/>
						</div>
					) : (
						<pre className="h-full overflow-auto bg-[var(--card)] p-[16px] text-[12px] leading-[1.6] text-[var(--foreground)]">
							<code>{state.text}</code>
						</pre>
					))}
			</div>
		</div>
	);
}

export default definePlugin({
	activate(ctx) {
		ctx.ui.registerFilePreview({
			extensions: ["svg"],
			component: SvgPreview,
		});
	},
});
