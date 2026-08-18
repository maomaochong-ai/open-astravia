import {
	activityPanelOpenAtom,
	confirmDialogAtom,
	knowledgeBaseEnabledAtom,
	knowledgeRetrievalActiveAtom,
	type SessionInfo,
} from "@shared/store/atoms";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

export type KnowledgeBusyState = "scan" | "clear" | "retry" | null;

export interface KnowledgeProbeResult {
	msg: string;
	ok: boolean;
}

export interface KnowledgeBaseSettingsModel {
	actions: {
		changeAgentConcurrency: (value: string) => void;
		changeInterval: (value: string) => void;
		changeModel: (value: string) => void;
		changeReasoning: (level: string) => void;
		clearWiki: () => void;
		openRecords: () => Promise<void>;
		probe: () => Promise<void>;
		retryFailed: () => Promise<void>;
		scan: () => Promise<void>;
		toggle: (checked: boolean) => void;
	};
	agentConcurrency: number;
	agentConcurrencyOptions: number[];
	busy: KnowledgeBusyState;
	enabled: boolean;
	interval: number;
	intervalOptions: number[];
	labels: KnowledgeBaseSettingsLabels;
	modelKey: string;
	neverInterval: number;
	probeResult: KnowledgeProbeResult | null;
	probing: boolean;
	reasoningLevel: string;
	status: string | null;
}

interface KnowledgeBaseSettingsLabels {
	clearWiki: string;
	clearWikiButton: string;
	clearWikiDescription: string;
	enable: string;
	enableDescription: string;
	everyNMinutes: (minutes: number) => string;
	howItWorks: string;
	howItWorksDescription: string;
	interval: string;
	intervalDescription: string;
	model: string;
	modelDescription: string;
	never: string;
	noModelSelected: string;
	parallel: string;
	parallelDescription: string;
	parallelN: (count: number) => string;
	processNow: string;
	processNowButton: string;
	processNowDescription: string;
	records: string;
	recordsDescription: string;
	retryFailed: string;
	retryFailedButton: string;
	retryFailedDescription: string;
	sections: {
		actions: string;
		processing: string;
	};
	selectModel: string;
	testConnect: string;
	title: string;
	viewRecords: string;
}

const POLL_INTERVALS = [3, 5, 10, 30];
const NEVER_INTERVAL = 0;
const AGENT_CONCURRENCY_OPTIONS = [1, 2, 3, 4, 6, 8];

export function useKnowledgeBaseSettingsModel(): KnowledgeBaseSettingsModel {
	const { t } = useTranslation("settings");
	const navigate = useNavigate();
	const setKnowledgeBaseEnabled = useSetAtom(knowledgeBaseEnabledAtom);
	const setKnowledgeRetrievalActive = useSetAtom(knowledgeRetrievalActiveAtom);
	const setActivityPanelOpen = useSetAtom(activityPanelOpenAtom);
	const confirm = useSetAtom(confirmDialogAtom);
	const [enabled, setEnabled] = useState(true);
	const [interval, setIntervalMinutes] = useState(5);
	const [agentConcurrency, setAgentConcurrency] = useState(3);
	const [modelKey, setModelKey] = useState<string>("");
	const [reasoningLevel, setReasoningLevel] = useState<string>("");
	const [busy, setBusy] = useState<KnowledgeBusyState>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [probing, setProbing] = useState(false);
	const [probeResult, setProbeResult] = useState<KnowledgeProbeResult | null>(null);

	useEffect(() => {
		void window.vetta.config.get().then((config) => {
			const kb = config.knowledgeBase;
			setEnabled(kb?.enabled === true);
			setIntervalMinutes(kb?.pollIntervalMinutes ?? 5);
			setAgentConcurrency(kb?.agentConcurrency ?? 3);
			setModelKey(kb?.processingModelKey ?? "");
			setReasoningLevel(kb?.processingModelReasoningLevel ?? "");
		});
	}, []);

	const persist = useCallback(
		async (patch: {
			agentConcurrency?: number;
			enabled?: boolean;
			pollIntervalMinutes?: number;
			processingModelKey?: string;
			processingModelReasoningLevel?: string;
		}) => {
			await window.vetta.config.set({ knowledgeBase: patch });
			await window.vetta.knowledge.reload();
		},
		[],
	);

	const handleToggle = useCallback(
		(checked: boolean) => {
			setEnabled(checked);
			setKnowledgeBaseEnabled(checked);
			if (!checked) setKnowledgeRetrievalActive(false);
			void persist({ enabled: checked });
			recordSettingsUsage({ tab: "knowledge", action: checked ? "enabled" : "disabled", target: "processing" });
		},
		[persist, setKnowledgeBaseEnabled, setKnowledgeRetrievalActive],
	);

	const handleInterval = useCallback(
		(value: string) => {
			const minutes = Number(value);
			setIntervalMinutes(minutes);
			void persist({ pollIntervalMinutes: minutes });
			recordSettingsUsage({ tab: "knowledge", action: "changed", target: "poll-interval", value });
		},
		[persist],
	);

	const handleAgentConcurrency = useCallback(
		(value: string) => {
			const count = Number(value);
			setAgentConcurrency(count);
			void persist({ agentConcurrency: count });
			recordSettingsUsage({ tab: "knowledge", action: "changed", target: "agent-concurrency", value });
		},
		[persist],
	);

	const handleModel = useCallback(
		(value: string) => {
			setModelKey(value);
			setProbeResult(null);
			void persist({ processingModelKey: value });
			recordSettingsUsage({ tab: "knowledge", action: value ? "selected" : "reset", target: "processing-model" });
		},
		[persist],
	);

	const handleReasoning = useCallback(
		(level: string) => {
			setReasoningLevel(level);
			void persist({ processingModelReasoningLevel: level });
			recordSettingsUsage({
				tab: "knowledge",
				action: level ? "changed" : "reset",
				target: "reasoning-level",
				value: level,
			});
		},
		[persist],
	);

	const handleProbe = useCallback(async () => {
		const slash = modelKey.indexOf("/");
		if (slash <= 0) {
			setProbeResult({ ok: false, msg: t("kbSelectModelFirst") });
			return;
		}
		setProbing(true);
		setProbeResult(null);
		try {
			const ref = { provider: modelKey.slice(0, slash), model: modelKey.slice(slash + 1) };
			const result = await window.vetta.models.probe(ref);
			setProbeResult({
				ok: result.ok,
				msg: result.ok ? (result.message ?? t("kbTestOk")) : (result.error ?? t("kbTestUnknown")),
			});
			recordSettingsUsage({ tab: "knowledge", action: "tested", target: "processing-model" });
		} finally {
			setProbing(false);
		}
	}, [modelKey, t]);

	const handleScan = useCallback(async () => {
		setBusy("scan");
		setStatus(null);
		try {
			const res = await window.vetta.knowledge.scanNow();
			setStatus(
				res.reason === "no-model" ? t("kbNoModelForProcess") : res.skipped ? t("kbNoChanges") : t("kbProcessing"),
			);
			recordSettingsUsage({ tab: "knowledge", action: "scanned", target: "wiki" });
		} catch (err) {
			setStatus(t("kbProcessFailed", { msg: err instanceof Error ? err.message : String(err) }));
		} finally {
			setBusy(null);
		}
	}, [t]);

	const handleRetryFailed = useCallback(async () => {
		setBusy("retry");
		setStatus(null);
		try {
			const res = await window.vetta.knowledge.retryFailed();
			setStatus(
				res.reason === "no-model" ? t("kbNoModelForProcess") : res.skipped ? t("kbNoChanges") : t("kbProcessing"),
			);
			recordSettingsUsage({ tab: "knowledge", action: "retried", target: "failed-files" });
		} catch (err) {
			setStatus(t("kbProcessFailed", { msg: err instanceof Error ? err.message : String(err) }));
		} finally {
			setBusy(null);
		}
	}, [t]);

	const handleClearWiki = useCallback(() => {
		confirm({
			title: t("kbClearWikiTitle"),
			message: t("kbClearWikiMsg"),
			variant: "danger",
			confirmLabel: t("kbClearConfirm"),
			onConfirm: () => {
				void (async () => {
					setBusy("clear");
					setStatus(null);
					try {
						await window.vetta.knowledge.clearWiki();
						setStatus(t("kbCleared"));
						recordSettingsUsage({ tab: "knowledge", action: "cleared", target: "wiki" });
					} catch (err) {
						setStatus(t("kbClearFailed", { msg: err instanceof Error ? err.message : String(err) }));
					} finally {
						setBusy(null);
					}
				})();
			},
		});
	}, [confirm, t]);

	const handleOpenRecords = useCallback(async () => {
		setStatus(null);
		const config = await window.vetta.config.get();
		const cwd = config.knowledgeProcessingCwd;
		const list = cwd ? ((await window.vetta.session.listSessions(cwd)) as SessionInfo[]) : [];
		if (list.length === 0) {
			setStatus(t("kbNoRecords"));
			return;
		}
		setActivityPanelOpen(true);
		void navigate({ to: "/viewer/$path", params: { path: encodeURIComponent(list[0].path) } });
	}, [navigate, setActivityPanelOpen, t]);

	const labels = useMemo<KnowledgeBaseSettingsLabels>(
		() => ({
			clearWiki: t("kbClearWiki"),
			clearWikiButton: t("kbClearWikiBtn"),
			clearWikiDescription: t("kbClearWikiDesc"),
			enable: t("kbEnable"),
			enableDescription: t("kbEnableDesc"),
			everyNMinutes: (minutes) => t("kbEveryNMinutes", { m: minutes }),
			howItWorks: t("kbHowItWorks"),
			howItWorksDescription: t("kbHowItWorksDesc"),
			interval: t("kbInterval"),
			intervalDescription: t("kbIntervalDesc"),
			model: t("kbModel"),
			modelDescription: t("kbModelDesc"),
			never: t("kbNever"),
			noModelSelected: t("kbNoModelSelected"),
			parallel: t("kbParallel"),
			parallelDescription: t("kbParallelDesc"),
			parallelN: (count) => t("kbParallelN", { n: count }),
			processNow: t("kbProcessNow"),
			processNowButton: t("kbProcessNowBtn"),
			processNowDescription: t("kbProcessNowDesc"),
			records: t("kbRecords"),
			recordsDescription: t("kbRecordsDesc"),
			retryFailed: t("kbRetryFailed"),
			retryFailedButton: t("kbRetryFailedBtn"),
			retryFailedDescription: t("kbRetryFailedDesc"),
			sections: {
				actions: t(SETTINGS_SECTION["knowledge-actions"].titleKey),
				processing: t(SETTINGS_SECTION["knowledge-processing"].titleKey),
			},
			selectModel: t("kbSelectModel"),
			testConnect: t("kbTestConnect"),
			title: t("kbTitle"),
			viewRecords: t("kbViewRecords"),
		}),
		[t],
	);

	return {
		actions: {
			changeAgentConcurrency: handleAgentConcurrency,
			changeInterval: handleInterval,
			changeModel: handleModel,
			changeReasoning: handleReasoning,
			clearWiki: handleClearWiki,
			openRecords: handleOpenRecords,
			probe: handleProbe,
			retryFailed: handleRetryFailed,
			scan: handleScan,
			toggle: handleToggle,
		},
		agentConcurrency,
		agentConcurrencyOptions: AGENT_CONCURRENCY_OPTIONS,
		busy,
		enabled,
		interval,
		intervalOptions: POLL_INTERVALS,
		labels,
		modelKey,
		neverInterval: NEVER_INTERVAL,
		probeResult,
		probing,
		reasoningLevel,
		status,
	};
}
