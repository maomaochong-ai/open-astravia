import type {
	ImAgentModelRef,
	ImBridgeConfig,
	ImBridgeStatus,
	ImLegacyDetection,
	ImLogEvent,
	ImSetConfigPayload,
	ImTransportSelector,
	ImTransportStatus,
} from "@preload/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ImGenericChannelTransport } from "./im-channel-catalog";
import { recordSettingsUsage } from "./recordSettingsUsage";

export interface FeishuFormState {
	appId: string;
	appSecret: string;
}

export interface FeishuValidation {
	errors: Partial<Record<keyof FeishuFormState, string>>;
	valid: boolean;
}

export interface ProbeResult {
	ok: boolean;
	msg: string;
}

export type ImChannelConfigTransport = ImGenericChannelTransport;

export interface ImChannelFormState {
	botToken: string;
	appToken: string;
	endpoint: string;
	account: string;
	attachmentsDir: string;
	path: string;
	allowlist: string;
}

export interface ImChannelDialogModel {
	transport: ImChannelConfigTransport | null;
	form: ImChannelFormState;
	open: boolean;
	showSecret: boolean;
	busy: boolean;
	error: string | null;
	message: string | null;
	setOpen: (open: boolean) => void;
	setShowSecret: React.Dispatch<React.SetStateAction<boolean>>;
	updateField: <K extends keyof ImChannelFormState>(key: K, value: ImChannelFormState[K]) => void;
	onSave: () => Promise<void>;
	onTest: () => Promise<void>;
	onBind: () => Promise<void>;
	onLogout: () => Promise<void>;
}

export interface ImBridgeSettingsModel {
	config: ImBridgeConfig | null;
	channelDialog: ImChannelDialogModel;

	feishuForm: FeishuFormState;
	feishuValidation: FeishuValidation;
	feishuDialogOpen: boolean;
	wechatDialogOpen: boolean;
	status: ImBridgeStatus | null;
	transportStatus: ImTransportStatus;
	showSecret: boolean;
	saving: boolean;
	saveError: string | null;
	saveOk: string | null;
	testing: boolean;
	testResult: string | null;
	logsOpen: boolean;
	logs: ImLogEvent[];
	legacy: ImLegacyDetection | null;
	importing: boolean;
	probing: boolean;
	probeResult: ProbeResult | null;
	setFeishuDialogOpen: (open: boolean) => void;
	setWechatDialogOpen: (open: boolean) => void;
	setShowSecret: React.Dispatch<React.SetStateAction<boolean>>;
	setLogsOpen: (open: boolean) => void;
	updateFeishuField: <K extends keyof FeishuFormState>(key: K, value: FeishuFormState[K]) => void;
	onImportLegacy: () => Promise<void>;
	onSkipLegacy: () => void;
	onPickModel: (next: ImAgentModelRef | null) => Promise<void>;
	onProbeModel: () => Promise<void>;
	onToggleEnabled: (enabled: boolean) => Promise<void>;
	onSwitchTransport: (next: ImTransportSelector) => Promise<void>;
	onOpenFeishuDialog: () => void;
	onOpenWechatDialog: () => void;
	onOpenChannelDialog: (transport: ImChannelConfigTransport) => void;
	onWechatLogout: () => Promise<void>;
	onSaveFeishu: () => Promise<void>;
	onTestFeishu: () => Promise<void>;
	onRestart: () => Promise<void>;
	onOpenLogs: () => Promise<void>;
	onWechatConfirmedRefresh: () => void;
	onDismissFeedback: () => void;
}

export function useImBridgeSettingsModel(): ImBridgeSettingsModel {
	const { t } = useTranslation("settings");
	const [config, setConfig] = useState<ImBridgeConfig | null>(null);
	const [feishuForm, setFeishuForm] = useState<FeishuFormState>(emptyFeishuForm);
	const [feishuDialogOpen, setFeishuDialogOpen] = useState(false);
	const [wechatDialogOpen, setWechatDialogOpen] = useState(false);
	const [channelDialogTransport, setChannelDialogTransport] = useState<ImChannelConfigTransport | null>(null);
	const [channelForm, setChannelForm] = useState<ImChannelFormState>(emptyChannelForm);
	const [channelShowSecret, setChannelShowSecret] = useState(false);
	const [channelBusy, setChannelBusy] = useState(false);
	const [channelError, setChannelError] = useState<string | null>(null);
	const [channelMessage, setChannelMessage] = useState<string | null>(null);
	const [status, setStatus] = useState<ImBridgeStatus | null>(null);
	const [showSecret, setShowSecret] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [saveOk, setSaveOk] = useState<string | null>(null);
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<string | null>(null);
	const [logsOpen, setLogsOpen] = useState(false);
	const [logs, setLogs] = useState<ImLogEvent[]>([]);
	const [legacy, setLegacy] = useState<ImLegacyDetection | null>(null);
	const [importing, setImporting] = useState(false);
	const [probing, setProbing] = useState(false);
	const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
	const unsubRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const loadedConfig = await window.vetta.im.getConfig();
			if (cancelled) return;
			setConfig(loadedConfig);
			setFeishuForm(feishuFormFromConfig(loadedConfig));
			setChannelForm(channelFormFromConfig(loadedConfig, loadedConfig.transport));

			const unsub = await window.vetta.im.subscribeStatus(
				(snap) => setStatus(snap),
				(log) => setLogs((prev) => [log, ...prev].slice(0, 500)),
			);
			if (cancelled) {
				unsub();
				return;
			}
			unsubRef.current = unsub;

			try {
				const detected = await window.vetta.im.detectLegacy();
				if (!cancelled && detected.hasLegacyData) {
					setLegacy(detected);
				}
			} catch {
				// best effort; non-fatal
			}
		})();

		return () => {
			cancelled = true;
			unsubRef.current?.();
			unsubRef.current = null;
		};
	}, []);

	const feishuValidation = useMemo(() => {
		const errors: Partial<Record<keyof FeishuFormState, string>> = {};
		if (!feishuForm.appId.trim()) errors.appId = t("imbFeishuAppIdRequired");
		if (!feishuForm.appSecret) errors.appSecret = t("appSecretRequired");
		return { errors, valid: Object.keys(errors).length === 0 };
	}, [feishuForm, t]);

	const updateFeishuField = useCallback(<K extends keyof FeishuFormState>(key: K, value: FeishuFormState[K]) => {
		setSaveError(null);
		setSaveOk(null);
		setFeishuForm((prev) => ({ ...prev, [key]: value }));
	}, []);

	const refreshConfig = useCallback(async () => {
		const refreshed = await window.vetta.im.getConfig();
		setConfig(refreshed);
		setFeishuForm(feishuFormFromConfig(refreshed));
		setChannelForm(channelFormFromConfig(refreshed, refreshed.transport));
		return refreshed;
	}, []);

	const handleImportLegacy = useCallback(async () => {
		if (!legacy || importing) return;
		setImporting(true);
		try {
			const result = await window.vetta.im.importLegacy(legacy);
			if (result.ok) {
				await refreshConfig();
				setLegacy(null);
				setSaveOk(t("imbImportOk"));
				recordSettingsUsage({ tab: "im", action: "imported", target: "legacy-config" });
			} else {
				setSaveError(result.error ?? t("imbImportFail"));
			}
		} finally {
			setImporting(false);
		}
	}, [importing, legacy, refreshConfig, t]);

	const handlePickModel = useCallback(
		async (next: ImAgentModelRef | null) => {
			if (!config) return;
			setSaving(true);
			setSaveError(null);
			setSaveOk(null);
			setProbeResult(null);
			try {
				const result = await window.vetta.im.setConfig({
					enabled: config.enabled,
					transport: config.transport,
					agentModel: next,
				});
				if (!result.ok) {
					setSaveError(result.error ?? t("saveModelFailed"));
					return;
				}
				await refreshConfig();
				setSaveOk(next ? t("setModelOk", { provider: next.provider, model: next.model }) : t("clearedModel"));
				recordSettingsUsage({ tab: "im", action: next ? "selected" : "reset", target: "agent-model" });
			} finally {
				setSaving(false);
			}
		},
		[config, refreshConfig, t],
	);

	const handleProbeModel = useCallback(async () => {
		if (!config?.agentModel) {
			setProbeResult({ ok: false, msg: t("pleaseSelectModel") });
			return;
		}
		setProbing(true);
		setProbeResult(null);
		try {
			const result = await window.vetta.im.probeAgentModel(config.agentModel);
			setProbeResult({
				ok: result.ok,
				msg: result.ok ? (result.message ?? t("testOk")) : (result.error ?? t("testUnknown")),
			});
			recordSettingsUsage({ tab: "im", action: "tested", target: "agent-model" });
		} finally {
			setProbing(false);
		}
	}, [config, t]);

	const handleToggleEnabled = useCallback(
		async (enabled: boolean) => {
			if (!config) return;
			if (enabled) {
				if (!config.agentModel) {
					setSaveError(t("pleaseChooseModel"));
					return;
				}
				if (config.transport === "feishu" && !feishuValidation.valid) {
					setSaveError(t("pleaseFillFeishu"));
					setFeishuDialogOpen(true);
					return;
				}
				if (config.transport === "wechat" && !config.wechat.bound) {
					setSaveError(t("pleaseBindWechat"));
					setWechatDialogOpen(true);
					return;
				}
			}
			setSaving(true);
			try {
				const payload: ImSetConfigPayload = {
					enabled,
					transport: config.transport,
					feishu:
						config.transport === "feishu" ? feishuFormToPayload(config, feishuForm, enabled).feishu : undefined,
				};
				const result = await window.vetta.im.setConfig(payload);
				if (!result.ok) {
					setSaveError(result.error ?? t("saveFailed"));
				} else {
					await refreshConfig();
					setSaveOk(enabled ? t("saveOk") : t("disableOk"));
					recordSettingsUsage({ tab: "im", action: enabled ? "enabled" : "disabled", target: "bridge" });
				}
			} finally {
				setSaving(false);
			}
		},
		[config, feishuForm, feishuValidation.valid, refreshConfig, t],
	);

	const handleSwitchTransport = useCallback(
		async (next: ImTransportSelector) => {
			if (!config || config.transport === next) return;
			setSaving(true);
			setSaveError(null);
			setSaveOk(null);
			try {
				const result = await window.vetta.im.setConfig({
					enabled: config.enabled,
					transport: next,
				});
				if (!result.ok) {
					setSaveError(result.error ?? t("switchFailed"));
					return;
				}
				await refreshConfig();
				setSaveOk(t("switchTo", { channel: next === "feishu" ? t("feishuChannel") : t("wechatChannel") }));
				recordSettingsUsage({ tab: "im", action: "changed", target: "transport", value: next });
			} finally {
				setSaving(false);
			}
		},
		[config, refreshConfig, t],
	);

	const handleWechatLogout = useCallback(async () => {
		if (!config) return;
		const ok = window.confirm(t("unbindConfirm"));
		if (!ok) return;
		setSaving(true);
		try {
			const result = await window.vetta.im.wechat.logout();
			if (!result.ok) {
				setSaveError(result.error ?? t("unbindError"));
				return;
			}
			await refreshConfig();
			setSaveOk(t("unbindSuccess"));
			recordSettingsUsage({ tab: "im", action: "deleted", target: "wechat-binding" });
		} finally {
			setSaving(false);
		}
	}, [config, refreshConfig, t]);

	const handleSaveFeishu = useCallback(async () => {
		if (!config || !feishuValidation.valid || saving) return;
		setSaving(true);
		setSaveError(null);
		setSaveOk(null);
		try {
			const result = await window.vetta.im.setConfig(feishuFormToPayload(config, feishuForm, config.enabled));
			if (!result.ok) {
				setSaveError(result.error ?? t("saveFailed"));
				return;
			}
			await refreshConfig();
			setSaveOk(result.mode === "plaintext" ? t("saveOkPlaintext") : t("saveOkEncrypted"));
			recordSettingsUsage({ tab: "im", action: "saved", target: "feishu-config" });
		} catch (err) {
			setSaveError((err as Error).message);
		} finally {
			setSaving(false);
		}
	}, [config, feishuForm, feishuValidation.valid, refreshConfig, saving, t]);

	const handleTestFeishu = useCallback(async () => {
		if (testing || !config) return;
		setTesting(true);
		setTestResult(null);
		try {
			const result = await window.vetta.im.testConnection({
				appId: feishuForm.appId.trim(),
				appSecret: feishuForm.appSecret,
				verificationToken: config.feishu.verificationToken || undefined,
				encryptKey: config.feishu.encryptKey || undefined,
				baseUrl: config.feishu.baseUrl || undefined,
			});
			setTestResult(result.ok ? (result.message ?? t("testPass")) : (result.error ?? t("testFail")));
			recordSettingsUsage({ tab: "im", action: "tested", target: "feishu-config" });
		} finally {
			setTesting(false);
		}
	}, [config, feishuForm, testing, t]);

	const handleOpenLogs = useCallback(async () => {
		const initial = await window.vetta.im.getRecentLogs();
		setLogs(initial);
		setLogsOpen(true);
	}, []);

	const handleOpenFeishuDialog = useCallback(() => {
		setSaveError(null);
		setSaveOk(null);
		setTestResult(null);
		setFeishuDialogOpen(true);
	}, []);

	const handleOpenChannelDialog = useCallback(
		(transport: ImChannelConfigTransport) => {
			if (!config) return;
			setSaveError(null);
			setSaveOk(null);
			setChannelError(null);
			setChannelMessage(null);
			setChannelShowSecret(false);
			setChannelForm(channelFormFromConfig(config, transport));
			setChannelDialogTransport(transport);
		},
		[config],
	);

	const handleUpdateChannelField = useCallback(
		<K extends keyof ImChannelFormState>(key: K, value: ImChannelFormState[K]) => {
			setChannelError(null);
			setChannelMessage(null);
			setChannelForm((prev) => ({ ...prev, [key]: value }));
		},
		[],
	);

	const handleSaveChannel = useCallback(async () => {
		if (!config || !channelDialogTransport || channelBusy) return;
		setChannelBusy(true);
		setChannelError(null);
		setChannelMessage(null);
		try {
			const result = await window.vetta.im.setConfig(
				channelFormToPayload(config, channelDialogTransport, channelForm),
			);
			if (!result.ok) {
				setChannelError(result.error ?? t("saveFailed"));
				return;
			}
			await refreshConfig();
			setChannelMessage(t("saveOk"));
		} finally {
			setChannelBusy(false);
		}
	}, [channelBusy, channelDialogTransport, channelForm, config, refreshConfig, t]);

	const handleTestChannel = useCallback(async () => {
		if (!channelDialogTransport || channelBusy) return;
		setChannelBusy(true);
		setChannelError(null);
		setChannelMessage(null);
		try {
			const result = await window.vetta.im.testConnection(channelTestPayload(channelDialogTransport, channelForm));
			if (result.ok) setChannelMessage(result.message ?? t("testPass"));
			else setChannelError(result.error ?? t("testFail"));
		} finally {
			setChannelBusy(false);
		}
	}, [channelBusy, channelDialogTransport, channelForm, t]);

	const handleChannelBind = useCallback(async () => {
		if (channelDialogTransport !== "whatsapp" || channelBusy) return;
		setChannelBusy(true);
		setChannelError(null);
		try {
			const result = await window.vetta.im.whatsapp.startBind();
			if (!result.ok) setChannelError(result.error ?? t("bindFailed"));
			else setChannelMessage(t("bindStarted"));
		} finally {
			setChannelBusy(false);
		}
	}, [channelBusy, channelDialogTransport, t]);

	const handleChannelLogout = useCallback(async () => {
		if (channelDialogTransport !== "whatsapp" || channelBusy) return;
		setChannelBusy(true);
		try {
			const result = await window.vetta.im.whatsapp.logout();
			if (!result.ok) setChannelError(result.error ?? t("unbindError"));
			else await refreshConfig();
		} finally {
			setChannelBusy(false);
		}
	}, [channelBusy, channelDialogTransport, refreshConfig, t]);

	const handleOpenWechatDialog = useCallback(() => {
		if (!config) return;
		setSaveError(null);
		setSaveOk(null);
		if (!config.wechat.bound && (config.transport !== "wechat" || !config.enabled)) {
			void window.vetta.im.setConfig({ enabled: true, transport: "wechat" });
		}
		setWechatDialogOpen(true);
	}, [config]);

	return {
		config,
		channelDialog: {
			transport: channelDialogTransport,
			form: channelForm,
			open: channelDialogTransport !== null,
			showSecret: channelShowSecret,
			busy: channelBusy,
			error: channelError,
			message: channelMessage,
			setOpen: (open) => {
				if (!open) setChannelDialogTransport(null);
			},
			setShowSecret: setChannelShowSecret,
			updateField: handleUpdateChannelField,
			onSave: handleSaveChannel,
			onTest: handleTestChannel,
			onBind: handleChannelBind,
			onLogout: handleChannelLogout,
		},
		feishuForm,
		feishuValidation,
		feishuDialogOpen,
		wechatDialogOpen,
		status,
		transportStatus: status?.transport ?? "offline",
		showSecret,
		saving,
		saveError,
		saveOk,
		testing,
		testResult,
		logsOpen,
		logs,
		legacy,
		importing,
		probing,
		probeResult,
		setFeishuDialogOpen,
		setWechatDialogOpen,
		setShowSecret,
		setLogsOpen,
		updateFeishuField,
		onImportLegacy: handleImportLegacy,
		onSkipLegacy: () => setLegacy(null),
		onPickModel: handlePickModel,
		onProbeModel: handleProbeModel,
		onToggleEnabled: handleToggleEnabled,
		onSwitchTransport: handleSwitchTransport,
		onOpenFeishuDialog: handleOpenFeishuDialog,
		onOpenWechatDialog: handleOpenWechatDialog,
		onOpenChannelDialog: handleOpenChannelDialog,
		onWechatLogout: handleWechatLogout,
		onSaveFeishu: handleSaveFeishu,
		onTestFeishu: handleTestFeishu,
		onRestart: async () => {
			await window.vetta.im.restart();
		},
		onOpenLogs: handleOpenLogs,
		onWechatConfirmedRefresh: () => {
			void refreshConfig();
		},
		onDismissFeedback: () => {
			setSaveError(null);
			setSaveOk(null);
		},
	};
}

function emptyFeishuForm(): FeishuFormState {
	return { appId: "", appSecret: "" };
}

function feishuFormFromConfig(config: ImBridgeConfig): FeishuFormState {
	return {
		appId: config.feishu.appId,
		appSecret: config.feishu.appSecret,
	};
}

function feishuFormToPayload(config: ImBridgeConfig, form: FeishuFormState, enabled: boolean): ImSetConfigPayload {
	return {
		enabled,
		feishu: {
			appId: form.appId.trim(),
			appSecret: form.appSecret,
			verificationToken: config.feishu.verificationToken || undefined,
			encryptKey: config.feishu.encryptKey || undefined,
			baseUrl: config.feishu.baseUrl || undefined,
		},
	};
}

function emptyChannelForm(): ImChannelFormState {
	return { botToken: "", appToken: "", endpoint: "", account: "", attachmentsDir: "", path: "", allowlist: "" };
}

function channelFormFromConfig(config: ImBridgeConfig, transport: ImTransportSelector): ImChannelFormState {
	const values =
		transport === "telegram"
			? config.telegram.allowedUserIds?.join(", ")
			: transport === "slack"
				? [...(config.slack.allowedUserIds ?? []), ...(config.slack.allowedChannelIds ?? [])].join(", ")
				: transport === "discord"
					? [...(config.discord.allowedUserIds ?? []), ...(config.discord.allowedGuildIds ?? [])].join(", ")
					: transport === "signal"
						? config.signal.allowedNumbers?.join(", ")
						: transport === "whatsapp"
							? config.whatsapp.allowedNumbers?.join(", ")
							: config.imessage.allowedHandles?.join(", ");
	return {
		...emptyChannelForm(),
		botToken:
			transport === "telegram"
				? config.telegram.botToken
				: transport === "slack"
					? config.slack.botToken
					: transport === "discord"
						? config.discord.botToken
						: "",
		appToken: transport === "slack" ? config.slack.appToken : "",
		endpoint: transport === "signal" ? config.signal.endpoint : "",
		account: transport === "signal" ? config.signal.account : "",
		attachmentsDir: transport === "signal" ? (config.signal.attachmentsDir ?? "") : "",
		path: transport === "imessage" ? (config.imessage.dbPath ?? "") : "",
		allowlist: values ?? "",
	};
}

function splitAllowlist(value: string): string[] | undefined {
	const items = value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	return items.length > 0 ? items : undefined;
}

function channelFormToPayload(
	config: ImBridgeConfig,
	transport: ImChannelConfigTransport,
	form: ImChannelFormState,
): ImSetConfigPayload {
	const allowlist = splitAllowlist(form.allowlist);
	const base = { enabled: config.enabled, transport };
	if (transport === "telegram")
		return {
			...base,
			telegram: {
				botToken: form.botToken.trim(),
				allowedUserIds: allowlist?.flatMap((value) => (/^\\d+$/.test(value) ? [Number(value)] : [])),
			},
		};
	if (transport === "slack")
		return {
			...base,
			slack: { botToken: form.botToken.trim(), appToken: form.appToken.trim(), allowedUserIds: allowlist },
		};
	if (transport === "discord")
		return { ...base, discord: { botToken: form.botToken.trim(), allowedUserIds: allowlist } };
	if (transport === "signal")
		return {
			...base,
			signal: {
				endpoint: form.endpoint.trim(),
				account: form.account.trim(),
				attachmentsDir: form.attachmentsDir.trim() || undefined,
				allowedNumbers: allowlist,
			},
		};
	if (transport === "whatsapp") return { ...base, whatsapp: { allowedNumbers: allowlist } };
	return { ...base, imessage: { dbPath: form.path.trim() || undefined, allowedHandles: allowlist } };
}

function channelTestPayload(transport: ImChannelConfigTransport, form: ImChannelFormState) {
	return {
		transport,
		botToken: form.botToken,
		appToken: form.appToken,
		endpoint: form.endpoint,
		account: form.account,
	};
}
