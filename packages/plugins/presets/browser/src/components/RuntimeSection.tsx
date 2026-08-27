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
		case "installing-runtime":
		case "installing-browser":
			return "console.status.installing";
		case "ready":
			return "console.status.ready";
		case "error":
			return "console.status.failed";
		case "outdated":
			return "console.status.outdated";
		case "browser-missing":
			return "console.status.browserMissing";
		default:
			return "console.status.missing";
	}
}

function dotStyle(status: RuntimeStatus): { background: string } {
	if (status.phase === "ready") return { background: "#22c55e" };
	if (status.phase === "error") return { background: "var(--destructive, #ef4444)" };
	if (status.phase === "outdated") return { background: "#f59e0b" };
	if (status.phase.startsWith("installing-") || status.phase === "checking") return { background: "#f59e0b" };
	return { background: "var(--muted-foreground)" };
}

/**
 * 运行时状态与安装向导——整页唯一真正的功能区。
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
	const busy = status.phase.startsWith("installing-") || status.phase === "checking";
	const showBrowserStep = status.phase === "browser-missing";
	const pulsing = status.phase.startsWith("installing-") || status.phase === "checking";

	const hint = ((): string | null => {
		if (status.phase === "missing" || status.phase === "error") return t("console.installHint");
		if (status.phase === "outdated") {
			return t("console.outdatedHint", {
				found: status.version ?? "?",
				required: MINIMUM_AGENT_BROWSER_VERSION,
			});
		}
		if (showBrowserStep) return t("console.chromeMissing");
		if (status.phase === "ready") return t("console.readyHint");
		return null;
	})();

	return (
		<section className="flex flex-col gap-2.5">
			<span className="browser-section-label">{t("runtime.sectionLabel")}</span>
			<div className="browser-card flex flex-col gap-3 p-4">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<span
						className={`browser-dot${pulsing ? " browser-pulse" : ""}`}
						style={dotStyle(status)}
						aria-hidden="true"
					/>
					<h2 className="text-sm font-medium">{t(statusKey(status))}</h2>
					{status.version ? (
						<code className="text-xs text-muted-foreground">agent-browser {status.version}</code>
					) : null}

					<div className="ms-auto flex flex-wrap items-center gap-2">
						{status.phase === "missing" ? (
							<button type="button" className="browser-button" onClick={onInstallRuntime} disabled={busy}>
								{t("console.install")}
							</button>
						) : null}
						{status.phase === "error" ? (
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
				</div>

				{hint ? <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
				{status.message ? <p className="text-xs" style={{ color: "var(--destructive, #ef4444)" }}>{status.message}</p> : null}
				{status.phase.startsWith("installing-") || status.phase === "error" ? (
					<pre className="browser-output" aria-label={t("console.status.installing")}>
						{status.recentOutput}
					</pre>
				) : null}
			</div>
		</section>
	);
}
