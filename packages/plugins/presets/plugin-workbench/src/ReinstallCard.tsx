import { type PluginCardProps, useTranslation } from "@vetta-org/plugin-sdk";
import { Button } from "@vetta/ui";
import { useState, type ReactNode } from "react";
import { findProjectById, type ProjectInfo } from "./project";
import { reinstallPluginToVetta } from "./reinstall";

/** Card type — must match tool return `cards[].type` and registerCardRenderer. */
export const REINSTALL_CARD_TYPE = "plugin-workbench:reinstall";

export interface ReinstallCardPayload {
	pluginId: string;
	/** Absolute project dir (plugin root with plugin.json). */
	projectDir?: string;
	name?: string;
	/** Human-readable why reinstall is required (permissions / commands / …). */
	reason?: string;
	permissions?: string[];
}

function RefreshIcon({ className }: { className?: string }): ReactNode {
	return (
		<svg className={className} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
			<path
				fill="currentColor"
				d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.1A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"
			/>
		</svg>
	);
}

/**
 * Tool-driven message card: user confirms reinstall when hot reload cannot
 * pick up permissions / commands / settingsSchema (etc.).
 */
export function ReinstallCard({ descriptor, pending }: PluginCardProps): ReactNode {
	const { t } = useTranslation();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const payload = (descriptor.payload ?? {}) as ReinstallCardPayload;

	if (pending) {
		return (
			<div className="rounded-lg border border-border/50 bg-card/80 px-3 py-2.5 text-[12px] text-muted-foreground">
				{t("card.reinstall.pending")}
			</div>
		);
	}

	if (!payload.pluginId) return null;

	const title = payload.name ?? payload.pluginId;
	const reason = payload.reason?.trim() || t("card.reinstall.defaultReason");

	const onReinstall = async (): Promise<void> => {
		setBusy(true);
		setError(null);
		try {
			if (!payload.projectDir) {
				throw new Error(t("card.reinstall.missingDir"));
			}
			// projectDir is the plugin root; discoverProjects includes cwd itself.
			const found = await findProjectById(payload.projectDir, payload.pluginId);
			const project: ProjectInfo =
				found ??
				({
					dir: payload.projectDir,
					id: payload.pluginId,
					name: title,
					version: "0.0.0",
					guidingWords: [],
					permissions: payload.permissions ?? [],
					zipPath: null,
				} satisfies ProjectInfo);
			await reinstallPluginToVetta(project);
			// page reloads on success
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	};

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
			<div className="min-w-0">
				<div className="text-[12px] font-medium text-foreground">{t("card.reinstall.title")}</div>
				<p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
					<span className="font-medium text-foreground/90">{title}</span>
					<span className="text-muted-foreground/80"> · {payload.pluginId}</span>
				</p>
				<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{reason}</p>
				<p className="mt-1 text-[10px] text-muted-foreground/70">{t("card.reinstall.refreshHint")}</p>
			</div>
			{error && (
				<pre className="whitespace-pre-wrap break-words rounded-md bg-destructive/10 px-2 py-1.5 font-sans text-[10px] text-destructive">
					{error}
				</pre>
			)}
			<div className="flex flex-wrap items-center gap-1.5">
				<Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => void onReinstall()}>
					{busy ? <RefreshIcon className="h-3 w-3 animate-spin" /> : null}
					{busy ? t("card.reinstall.busy") : t("card.reinstall.action")}
				</Button>
			</div>
		</div>
	);
}
