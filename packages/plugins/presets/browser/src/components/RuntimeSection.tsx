import { useTranslation } from "@vetta-org/plugin-sdk";
import type { JSX } from "react";
import { MINIMUM_AGENT_BROWSER_VERSION, type RuntimeStatus } from "../runtime/runtime-controller";

export interface RuntimeSectionProps {
	status: RuntimeStatus;
	onInstallRuntime: () => void;
	onInstallBrowser: () => void;
	onRecheck: () => void;
}

function statusKey(status: RuntimeStatus): string {
	switch (status.phase) {
		case "checking":
			return "console.status.checking";
		case "installing":
			return "console.status.installing";
		case "ready":
			return "console.status.ready";
		case "failed":
			return "console.status.failed";
		case "outdated":
			return "console.status.outdated";
		default:
			return "console.status.missing";
	}
}

function dotClass(status: RuntimeStatus): string {
	if (status.phase === "ready") return "bg-emerald-500";
	if (status.phase === "failed") return "bg-red-500";
	if (status.phase === "outdated") return "bg-amber-500";
	if (status.phase === "installing" || status.phase === "checking") return "bg-amber-500 animate-pulse";
	return "bg-zinc-400";
}

/**
 * 运行时状态与安装向导。
 *
 * 安装分两步且第二步**不自动执行**：`agent-browser install` 会下载几百 MB 的
 * Chrome for Testing，而多数用户机器上已经有 Chrome 可以直接复用。第一步的输出里
 * 能读出本机有没有 Chrome，读得出来就据此决定是否提示第二步，读不出来就把选择交给用户。
 */
export function RuntimeSection({
	status,
	onInstallRuntime,
	onInstallBrowser,
	onRecheck,
}: RuntimeSectionProps): JSX.Element {
	const { t } = useTranslation();
	const busy = status.phase === "installing" || status.phase === "checking";
	const showBrowserStep = status.phase === "ready" && status.chromeDetected === false;

	return (
		<section className="browser-card" aria-label={t("console.title")}>
			<header className="flex items-center gap-2">
				<span className={`size-2 rounded-full ${dotClass(status)}`} aria-hidden="true" />
				<h2 className="text-sm font-medium">{t(statusKey(status))}</h2>
				{status.version ? <span className="text-xs opacity-60">{status.version}</span> : null}
			</header>

			{status.phase === "missing" || status.phase === "failed" ? (
				<p className="text-xs opacity-70">{t("console.installHint")}</p>
			) : null}

			{status.phase === "outdated" ? (
				<p className="text-xs opacity-70">
					{t("console.outdatedHint", { found: status.version ?? "?", required: MINIMUM_AGENT_BROWSER_VERSION })}
				</p>
			) : null}

			{status.phase === "ready" && status.chromeDetected === true ? (
				<p className="text-xs opacity-70">{t("console.chromeFound")}</p>
			) : null}
			{showBrowserStep ? <p className="text-xs opacity-70">{t("console.chromeMissing")}</p> : null}

			{status.message ? <p className="text-xs text-red-500">{status.message}</p> : null}

			{status.phase === "installing" || status.phase === "failed" ? (
				<pre className="browser-output" aria-label={t("console.status.installing")}>
					{status.output}
				</pre>
			) : null}

			<div className="flex flex-wrap gap-2">
				{status.phase === "missing" ? (
					<button type="button" className="browser-button" onClick={onInstallRuntime} disabled={busy}>
						{t("console.install")}
					</button>
				) : null}
				{status.phase === "failed" ? (
					<button type="button" className="browser-button" onClick={onInstallRuntime} disabled={busy}>
						{t("console.retry")}
					</button>
				) : null}
				{status.phase === "outdated" ? (
					<button type="button" className="browser-button" onClick={onInstallRuntime} disabled={busy}>
						{t("console.upgrade")}
					</button>
				) : null}
				{showBrowserStep ? (
					<button type="button" className="browser-button" onClick={onInstallBrowser} disabled={busy}>
						{t("console.install")}
					</button>
				) : null}
				<button type="button" className="browser-button-ghost" onClick={onRecheck} disabled={busy}>
					{t("console.recheck")}
				</button>
			</div>
		</section>
	);
}
