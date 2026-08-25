import { useTranslation } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import type { BrowserActivityEntry } from "../activity/log";
import type { BrowserPluginSettings } from "../config/settings";

export interface PolicySectionProps {
	settings: BrowserPluginSettings;
	allowedDomains: readonly string[];
	entries: readonly BrowserActivityEntry[];
}

function formatTime(timestamp: number): string {
	const date = new Date(timestamp);
	const pad = (value: number): string => String(value).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 安全策略现状 + 本次运行的浏览器动作流水（含被拦下的）。 */
export function PolicySection({ settings, allowedDomains, entries }: PolicySectionProps): JSX.Element {
	const { t } = useTranslation();
	const denied = [
		settings.denyEval ? "eval" : null,
		settings.denyUpload ? "upload" : null,
		settings.denyDownload ? "download" : null,
	].filter((value): value is string => value !== null);

	return (
		<section className="browser-card" aria-label={t("console.policy.title")}>
			<h2 className="text-sm font-medium">{t("console.policy.title")}</h2>
			{settings.browserSource === "attach" ? (
				<p className="text-xs text-amber-600">{t("console.policy.attachWarning")}</p>
			) : null}
			<ul className="flex flex-wrap gap-1">
				{allowedDomains.map((domain) => (
					<li key={domain} className="browser-chip">
						{domain}
					</li>
				))}
				{denied.map((category) => (
					<li key={category} className="browser-chip browser-chip-deny">
						{`deny:${category}`}
					</li>
				))}
			</ul>

			<h3 className="text-xs font-medium opacity-80">{t("console.log.title")}</h3>
			{entries.length === 0 ? <p className="text-xs opacity-60">{t("console.log.empty")}</p> : null}
			<ul className="flex flex-col gap-1">
				{entries.map((entry) => (
					<li key={entry.id} className="browser-row">
						<span className="font-mono text-xs opacity-50">{formatTime(entry.timestamp)}</span>
						<span className="min-w-0 flex-1 truncate" title={entry.reason ?? entry.target}>
							{entry.tool}
							{entry.target ? <span className="ml-2 opacity-70">{entry.target}</span> : null}
						</span>
						{entry.outcome === "blocked" ? (
							<span className="browser-chip browser-chip-deny">{t("console.log.blocked")}</span>
						) : null}
					</li>
				))}
			</ul>
		</section>
	);
}
