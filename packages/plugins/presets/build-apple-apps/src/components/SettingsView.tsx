import { useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, useEffect, useState } from "react";
import { getPluginCtx } from "../plugin-context.js";
import { MINIMUM_BAGUETTE_VERSION } from "../runtime/baguette-version.js";
import type { PanelSettings } from "../runtime/panel-settings.js";
import { getRuntimeController } from "../runtime/runtime-instance.js";
import { buildSimulatorsUrl } from "../runtime/serve-url.js";
import { getSettingsStore } from "../runtime/settings-instance.js";
import { errorMessage, type RuntimeState } from "../runtime/simulator-runtime.js";
import { DeviceIcon } from "./icons.js";
import { INSTALL_COMMAND } from "./RuntimeGate.js";

function statusKey(state: RuntimeState): string {
	switch (state.phase) {
		case "ready":
			return "settings.runtime.ready";
		case "missing":
			return "settings.runtime.missing";
		case "outdated":
			return "settings.runtime.outdated";
		case "unsupported":
			return "settings.runtime.unsupported";
		case "error":
			return "settings.runtime.failed";
		default:
			return "settings.runtime.checking";
	}
}

function dotColor(state: RuntimeState): string {
	if (state.phase === "ready") return "#22c55e";
	if (state.phase === "error" || state.phase === "unsupported") return "var(--destructive, #ef4444)";
	if (state.phase === "checking") return "#f59e0b";
	return "#f59e0b";
}

function Toggle(props: {
	readonly checked: boolean;
	readonly title: string;
	readonly description: string;
	readonly onChange: (next: boolean) => void;
}): JSX.Element {
	return (
		<label className="flex cursor-pointer items-start gap-3">
			<input
				type="checkbox"
				className="mt-0.5 size-3.5 flex-shrink-0 accent-[var(--primary)]"
				checked={props.checked}
				onChange={(event) => props.onChange(event.target.checked)}
			/>
			<span className="flex min-w-0 flex-col gap-1">
				<span className="text-[13px] leading-none">{props.title}</span>
				<span className="text-xs leading-relaxed text-muted-foreground">{props.description}</span>
			</span>
		</label>
	);
}

/** 工作区配置页：运行时状态、服务控制与插件自身的开关。 */
export function SettingsView(): JSX.Element {
	const { t } = useTranslation();
	const controller = getRuntimeController();
	const store = getSettingsStore();
	const [state, setState] = useState<RuntimeState>(() => controller.current());
	const [settings, setSettings] = useState<PanelSettings>(() => store.current());
	const [diagnostics, setDiagnostics] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [copied, setCopied] = useState(false);

	useEffect(() => controller.subscribe(setState), [controller]);
	useEffect(() => store.subscribe(setSettings), [store]);
	useEffect(() => {
		void store.load();
		void controller.refresh();
	}, [controller, store]);

	const needsInstall = state.phase === "missing" || state.phase === "outdated";
	const statusText = t(statusKey(state), {
		version: state.version ?? "?",
		found: state.version ?? "?",
		required: MINIMUM_BAGUETTE_VERSION,
	});

	const restart = (): void => {
		setBusy(true);
		setDiagnostics(null);
		void controller
			.restartServer()
			.then(() => controller.ensureServer())
			.catch(async (cause: unknown) => {
				setDiagnostics((await controller.serverDiagnostics()) ?? errorMessage(cause));
			})
			.finally(() => setBusy(false));
	};

	return (
		<div className="ios-sim-page">
			<div className="ios-sim-page-inner">
				<header className="flex items-start gap-4">
					<span className="flex size-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)] text-muted-foreground">
						<DeviceIcon />
					</span>
					<div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
						<h1 className="text-xl font-semibold tracking-tight">{t("settings.title")}</h1>
						<p className="text-sm leading-relaxed text-muted-foreground">{t("settings.tagline")}</p>
					</div>
				</header>

				<section className="flex flex-col gap-2.5">
					<span className="ios-sim-section-label">{t("settings.runtime.heading")}</span>
					<div className="ios-sim-card flex flex-col gap-3 p-4">
						<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
							<span
								className={`ios-sim-dot${state.phase === "checking" ? " ios-sim-pulse" : ""}`}
								style={{ background: dotColor(state) }}
								aria-hidden="true"
							/>
							<h2 className="text-sm font-medium">{statusText}</h2>
							<div className="ms-auto flex flex-wrap items-center gap-2">
								{needsInstall ? (
									<button
										type="button"
										className="ios-sim-button"
										onClick={() => {
											void navigator.clipboard
												.writeText(INSTALL_COMMAND)
												.then(() => {
													setCopied(true);
													setTimeout(() => setCopied(false), 1500);
												})
												.catch(() => undefined);
										}}
									>
										{copied ? t("gate.copied") : t("gate.copy")}
									</button>
								) : null}
								<button type="button" className="ios-sim-button-ghost" onClick={() => void controller.refresh()}>
									{t("gate.recheck")}
								</button>
							</div>
						</div>
						{needsInstall ? (
							<p className="text-xs leading-relaxed text-muted-foreground">
								{t("settings.runtime.installHint")} <code className="ios-sim-code">{INSTALL_COMMAND}</code>
							</p>
						) : null}
						{state.message ? (
							<p className="text-xs" style={{ color: "var(--destructive, #ef4444)" }}>
								{state.message}
							</p>
						) : null}
					</div>
				</section>

				<section className="flex flex-col gap-2.5">
					<span className="ios-sim-section-label">{t("settings.service.heading")}</span>
					<div className="ios-sim-card flex flex-col gap-3 p-4">
						<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
							<span
								className="ios-sim-dot"
								style={{ background: state.serverPort === undefined ? "var(--muted-foreground)" : "#22c55e" }}
								aria-hidden="true"
							/>
							<h2 className="text-sm font-medium">
								{state.serverPort === undefined
									? t("settings.service.stopped")
									: t("settings.service.running", { port: String(state.serverPort) })}
							</h2>
							<div className="ms-auto flex flex-wrap items-center gap-2">
								<button type="button" className="ios-sim-button-ghost" disabled={busy} onClick={restart}>
									{t("settings.service.restart")}
								</button>
								<button
									type="button"
									className="ios-sim-button-ghost"
									disabled={state.serverPort === undefined}
									onClick={() => {
										if (state.serverPort === undefined) return;
										void getPluginCtx()
											.ui.openExternal(buildSimulatorsUrl(state.serverPort))
											.catch(() => undefined);
									}}
								>
									{t("panel.openExternal")}
								</button>
							</div>
						</div>
						<p className="text-xs leading-relaxed text-muted-foreground">{t("settings.service.hint")}</p>
						{diagnostics ? <pre className="ios-sim-output">{diagnostics}</pre> : null}
					</div>
				</section>

				<section className="flex flex-col gap-2.5">
					<span className="ios-sim-section-label">{t("settings.device.heading")}</span>
					<div className="ios-sim-card flex flex-col gap-3 p-4">
						<label className="flex flex-col gap-2">
							<span className="text-[13px]">{t("settings.device.label")}</span>
							<select
								className="w-full rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-[13px]"
								value={settings.defaultDeviceUdid ?? ""}
								onChange={(event) =>
									void store.update({ defaultDeviceUdid: event.target.value || null })
								}
							>
								<option value="">{t("settings.device.auto")}</option>
								{state.devices.map((item) => (
									<option key={item.udid} value={item.udid}>
										{`${item.name} · ${item.runtime}`}
									</option>
								))}
							</select>
						</label>
						<p className="text-xs leading-relaxed text-muted-foreground">{t("settings.device.hint")}</p>
					</div>
				</section>

				<section className="flex flex-col gap-2.5">
					<span className="ios-sim-section-label">{t("settings.options.heading")}</span>
					<div className="ios-sim-card flex flex-col gap-4 p-4">
						<Toggle
							checked={settings.alwaysShowTab}
							title={t("settings.options.alwaysShowTab.title")}
							description={t("settings.options.alwaysShowTab.description")}
							onChange={(next) => void store.update({ alwaysShowTab: next })}
						/>
						<Toggle
							checked={settings.autoStartServer}
							title={t("settings.options.autoStartServer.title")}
							description={t("settings.options.autoStartServer.description")}
							onChange={(next) => void store.update({ autoStartServer: next })}
						/>
					</div>
				</section>

				<footer className="flex flex-col gap-2 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
					<p>{t("settings.footer.credit")}</p>
					<p>{t("settings.footer.agent")}</p>
				</footer>
			</div>
		</div>
	);
}
