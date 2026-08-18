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

export interface ImBridgeSettingsModel {
	config: ImBridgeConfig | null;
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
	onWechatLogout: () => Promise<void>;
	onSaveFeishu: () => Promise<void>;
	onTestFeishu: () => Promise<void>;
	onRestart: () => Promise<void>;
	onOpenLogs: () => Promise<void>;
	onWechatConfirmedRefresh: () => void;
}

export function useImBridgeSettingsModel(): ImBridgeSettingsModel {
	const { t } = useTranslation("settings");
	const [config, setConfig] = useState<ImBridgeConfig | null>(null);
	const [feishuForm, setFeishuForm] = useState<FeishuFormState>(emptyFeishuForm);
	const [feishuDialogOpen, setFeishuDialogOpen] = useState(false);
	const [wechatDialogOpen, setWechatDialogOpen] = useState(false);
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
