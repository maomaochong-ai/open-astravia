import { useActivityTab, useTranslation } from "@vetta-org/plugin-sdk";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { getPluginCtx } from "../plugin-context.js";
import { selectPreferredDevice, type SimulatorDevice } from "../runtime/device-registry.js";
import type { PanelSettings } from "../runtime/panel-settings.js";
import { getRuntimeController } from "../runtime/runtime-instance.js";
import { buildDeviceUrl, buildSimulatorsUrl } from "../runtime/serve-url.js";
import { getSettingsStore } from "../runtime/settings-instance.js";
import { errorMessage, type RuntimeState } from "../runtime/simulator-runtime.js";
import { ExternalIcon, RefreshIcon } from "./icons.js";
import { RuntimeGate } from "./RuntimeGate.js";
import { SimulatorWebview } from "./SimulatorWebview.js";

function CenteredNotice({
	message,
	action,
}: {
	readonly message: string;
	readonly action?: { readonly label: string; readonly onClick: () => void };
}): JSX.Element {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
			<p className="text-xs leading-relaxed text-muted-foreground">{message}</p>
			{action ? (
				<button type="button" className="ios-sim-button" onClick={action.onClick}>
					{action.label}
				</button>
			) : null}
		</div>
	);
}

/**
 * 活动 Tab 面板。
 *
 * 画面、手势和全部设备工具都由内嵌的 baguette 控制台提供；这里只做四件事：
 * 运行时门禁、拉起 serve、挑一台设备并确保它已启动、直接进入该设备的控制台。
 * 刻意不落在列表页——列表页的 Stream 按钮走 window.open，webview 会拦掉。
 */
export function SimulatorPanel(): JSX.Element {
	const { t } = useTranslation();
	const { active } = useActivityTab();
	const controller = getRuntimeController();
	const store = getSettingsStore();
	const [state, setState] = useState<RuntimeState>(() => controller.current());
	const [settings, setSettings] = useState<PanelSettings>(() => store.current());
	const [error, setError] = useState<string | null>(null);
	/** 已尝试过自动启动的设备。boot 失败后不再重试，否则 effect 会无限重跑。 */
	const bootAttemptedRef = useRef<Set<string>>(new Set());

	useEffect(() => controller.subscribe(setState), [controller]);
	useEffect(() => store.subscribe(setSettings), [store]);

	// 首次进入面板才探测：注册阶段就跑会给每个会话都拉一次子进程。
	useEffect(() => {
		if (!active) return;
		void store.load();
		void controller.refresh();
	}, [active, controller, store]);

	const startServer = useCallback((): void => {
		setError(null);
		void controller.ensureServer().catch(async (cause: unknown) => {
			setError((await controller.serverDiagnostics()) ?? errorMessage(cause));
		});
	}, [controller]);

	// serve 只在真的要看画面时才起，且整个插件共用一个。
	useEffect(() => {
		if (!active || state.phase !== "ready") return;
		if (state.serverPort !== undefined || !settings.autoStartServer) return;
		startServer();
	}, [active, settings.autoStartServer, startServer, state.phase, state.serverPort]);

	const device: SimulatorDevice | null = selectPreferredDevice(state.devices, settings.defaultDeviceUdid);

	// 选中的设备没开机就替用户开：面板的意义就是「打开就能看到画面」。
	useEffect(() => {
		if (!active || state.phase !== "ready" || device === null) return;
		if (device.state === "Booted" || state.bootingUdid !== undefined) return;
		if (bootAttemptedRef.current.has(device.udid)) return;
		bootAttemptedRef.current.add(device.udid);
		void controller.ensureBooted(device).catch((cause: unknown) => setError(errorMessage(cause)));
	}, [active, controller, device, state.bootingUdid, state.phase]);

	if (state.phase === "checking") {
		return <CenteredNotice message={t("panel.checking")} />;
	}
	if (state.phase !== "ready") {
		return <RuntimeGate state={state} onRecheck={() => void controller.refresh()} />;
	}
	if (error !== null) {
		return (
			<div className="flex h-full flex-col gap-3 p-5">
				<p className="text-sm font-medium">{t("panel.serverFailed")}</p>
				<pre className="ios-sim-output">{error}</pre>
				<div>
					<button type="button" className="ios-sim-button" onClick={startServer}>
						{t("panel.retry")}
					</button>
				</div>
			</div>
		);
	}
	if (state.serverPort === undefined) {
		return settings.autoStartServer ? (
			<CenteredNotice message={t("panel.startingServer")} />
		) : (
			<CenteredNotice
				message={t("panel.serverIdle")}
				action={{ label: t("panel.startServer"), onClick: startServer }}
			/>
		);
	}
	if (device === null) {
		return <CenteredNotice message={t("panel.noDevice")} />;
	}
	if (device.state !== "Booted") {
		return state.bootingUdid === device.udid ? (
			<CenteredNotice message={t("panel.booting", { name: device.name })} />
		) : (
			<CenteredNotice
				message={t("panel.bootFailed", { name: device.name })}
				action={{
					label: t("panel.retry"),
					onClick: () => {
						setError(null);
						bootAttemptedRef.current.delete(device.udid);
						void controller.refreshDevices();
					},
				}}
			/>
		);
	}

	const port = state.serverPort;
	return (
		<div className="flex h-full min-h-0 flex-col bg-background text-foreground">
			<div className="flex flex-shrink-0 items-center gap-2 px-2.5 py-1.5">
				<span className="ios-sim-dot" style={{ background: "#22c55e" }} aria-hidden="true" />
				<span className="truncate text-[11px] text-muted-foreground">
					{device.name} · {device.runtime}
				</span>
				<div className="ms-auto flex items-center gap-0.5">
					<button
						type="button"
						className="ios-sim-icon-button"
						title={t("panel.restart")}
						onClick={() => {
							setError(null);
							void controller.restartServer().then(startServer);
						}}
					>
						<RefreshIcon label={t("panel.restart")} />
					</button>
					<button
						type="button"
						className="ios-sim-icon-button"
						title={t("panel.openExternal")}
						onClick={() => {
							void getPluginCtx()
								.ui.openExternal(buildSimulatorsUrl(port))
								.catch(() => undefined);
						}}
					>
						<ExternalIcon label={t("panel.openExternal")} />
					</button>
				</div>
			</div>
			{/* key 绑端口 + udid：换设备或 serve 重启时重新挂载 guest。 */}
			<SimulatorWebview key={`${port}:${device.udid}`} url={buildDeviceUrl(port, device.udid)} />
		</div>
	);
}
