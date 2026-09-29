import { openSetupWizard } from "@domains/setup-wizard";
import type {
	BuiltinNotificationSoundId,
	DesktopNotificationPreferences,
	NotificationDeliveryScope,
	NotificationEventType,
} from "@preload/api";
import { playNotificationSound } from "@shared/audio/notification-sound-player";
import {
	confirmDialogAtom,
	debugModeAtom,
	type SessionExecutionMode,
	sessionExecutionModeAtom,
	workspacePathAtom,
} from "@shared/store/atoms";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/shared/notification-preferences";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

export interface GeneralSettingsModel {
	actions: {
		changeExecutionMode: (mode: string) => Promise<void>;
		exportDiagnostics: () => Promise<void>;
		resetWorkspace: () => Promise<void>;
		selectWorkspace: () => Promise<void>;
		startAppGuide: () => void;
		toggleDebug: (checked: boolean) => void;
		toggleNotifications: (checked: boolean) => void;
		toggleSound: (enabled: boolean) => void;
		changeNotificationSystemScope: (scope: NotificationDeliveryScope) => void;
		changeNotificationSoundScope: (scope: NotificationDeliveryScope) => void;
		changeNotificationSoundVolume: (volume: number) => void;
		changeNotificationEventSystem: (event: NotificationEventType, enabled: boolean) => void;
		changeNotificationEventSound: (event: NotificationEventType, soundId: BuiltinNotificationSoundId | null) => void;
		previewNotificationSound: (soundId?: BuiltinNotificationSoundId) => void;
	};
	debugMode: boolean;
	executionMode: SessionExecutionMode;
	exportingDiagnostics: boolean;
	labels: GeneralSettingsLabels;
	notificationsEnabled: boolean;
	notificationPreferences: DesktopNotificationPreferences;
	sandboxUnavailableReason: string | null;
	workspacePath: string;
}

interface GeneralSettingsLabels {
	appVersion: string;
	debugMode: string;
	debugModeDescription: string;
	export: string;
	exportDiagnostics: string;
	exportDiagnosticsDescription: string;
	exporting: string;
	fullAccess: string;
	reset: string;
	sandboxDescription: string;
	sandboxTitle: string;
	sections: {
		app: string;
		basics: string;
		developer: string;
		notifications: string;
	};
	startAppGuide: string;
	startAppGuideAction: string;
	startAppGuideDescription: string;
	systemNotifications: string;
	systemNotificationsDescription: string;
	notificationSound: string;
	notificationSoundDescription: string;
	notificationSystemTiming: string;
	notificationSoundTiming: string;
	notificationSoundVolume: string;
	notificationEvents: string;
	notificationEventCompleted: string;
	notificationEventFailed: string;
	notificationEventActionRequired: string;
	notificationSystemBanner: string;
	notificationPreview: string;
	notificationPreviewAction: string;
	notificationNoSound: string;
	notificationScopes: Record<NotificationDeliveryScope, string>;
	notificationSounds: Record<BuiltinNotificationSoundId, string>;
	title: string;
	useSandbox: string;
	workspaceDescription: string;
	workspaceTitle: string;
}

export function useGeneralSettingsModel(): GeneralSettingsModel {
	const { t } = useTranslation("settings");
	const [workspacePath, setWorkspacePath] = useAtom(workspacePathAtom);
	const [debugMode, setDebugMode] = useAtom(debugModeAtom);
	const [executionMode, setExecutionMode] = useAtom(sessionExecutionModeAtom);
	const setConfirmDialog = useSetAtom(confirmDialogAtom);
	const [sandboxUnavailableReason, setSandboxUnavailableReason] = useState<string | null>(null);
	const [notificationsEnabled, setNotificationsEnabled] = useState(true);
	const [notificationPreferences, setNotificationPreferences] = useState(DEFAULT_NOTIFICATION_PREFERENCES);
	const [exportingDiagnostics, setExportingDiagnostics] = useState(false);

	useEffect(() => {
		void window.vetta.config.get().then((config) => {
			setNotificationsEnabled(config.notificationsEnabled !== false);
			setNotificationPreferences(config.notificationPreferences);
			const mode = config.defaultExecutionMode ?? "full-access";
			setExecutionMode(mode);
			localStorage.setItem("vetta-session-execution-mode", mode);
			const capability = config.sandbox ?? config.linuxSandbox;
			if (capability?.status === "unavailable") {
				const reason = capability.reason ?? "unknown_error";
				const platform = "platform" in capability ? capability.platform : "linux";
				setSandboxUnavailableReason(t("sandboxUnavailable", { platform, reason }));
				return;
			}
			setSandboxUnavailableReason(null);
		});
	}, [setExecutionMode, t]);

	const selectWorkspace = useCallback(async () => {
		const selected = await window.vetta.dialog.selectFolder();
		if (!selected) return;
		setWorkspacePath(selected);
		localStorage.setItem("vetta-workspace-path", selected);
		await window.vetta.config.set({ workspacePath: selected });
		recordSettingsUsage({ tab: "general", action: "selected", target: "workspace" });
	}, [setWorkspacePath]);

	const resetWorkspace = useCallback(async () => {
		const defaultPath = "~/.vetta/workspace";
		setWorkspacePath(defaultPath);
		localStorage.setItem("vetta-workspace-path", defaultPath);
		await window.vetta.config.set({ workspacePath: defaultPath });
		recordSettingsUsage({ tab: "general", action: "reset", target: "workspace" });
	}, [setWorkspacePath]);

	const toggleDebug = useCallback(
		(checked: boolean) => {
			if (!checked) {
				setConfirmDialog({
					title: t("closeDebugTitle"),
					message: t("closeDebugMessage"),
					confirmLabel: t("closeDebugConfirm"),
					variant: "danger",
					onConfirm: () => {
						void window.vetta.debug.clearDebugDir();
						setDebugMode(false);
						localStorage.setItem("vetta-debug-mode", "false");
						void window.vetta.config.set({ debugMode: false });
						recordSettingsUsage({ tab: "general", action: "disabled", target: "debug-mode" });
					},
				});
				return;
			}
			setDebugMode(true);
			localStorage.setItem("vetta-debug-mode", "true");
			void window.vetta.config.set({ debugMode: true });
			recordSettingsUsage({ tab: "general", action: "enabled", target: "debug-mode" });
		},
		[setConfirmDialog, setDebugMode, t],
	);

	const exportDiagnostics = useCallback(async () => {
		if (exportingDiagnostics) return;
		setExportingDiagnostics(true);
		try {
			await window.vetta.diagnostics.exportDiagnosticsPackage();
		} catch (error) {
			console.error("[GeneralSettings] failed to export diagnostics:", error);
			setConfirmDialog({
				title: t("exportDiagnosticsFailed"),
				message: error instanceof Error ? error.message : String(error),
				confirmLabel: t("gotIt"),
				onConfirm: () => {},
			});
		} finally {
			setExportingDiagnostics(false);
		}
	}, [exportingDiagnostics, setConfirmDialog, t]);

	const toggleNotifications = useCallback((checked: boolean) => {
		setNotificationsEnabled(checked);
		void window.vetta.config.set({ notificationsEnabled: checked });
		recordSettingsUsage({ tab: "general", action: checked ? "enabled" : "disabled", target: "notifications" });
	}, []);

	const updateNotificationPreferences = useCallback(
		(update: (current: DesktopNotificationPreferences) => DesktopNotificationPreferences) => {
			setNotificationPreferences((current) => {
				const next = update(current);
				void window.vetta.config.set({ notificationPreferences: next });
				return next;
			});
		},
		[],
	);

	const changeNotificationEvent = useCallback(
		(
			event: NotificationEventType,
			update: (
				current: DesktopNotificationPreferences["events"][NotificationEventType],
			) => DesktopNotificationPreferences["events"][NotificationEventType],
		) =>
			updateNotificationPreferences((current) => ({
				...current,
				events: { ...current.events, [event]: update(current.events[event]) },
			})),
		[updateNotificationPreferences],
	);

	const changeExecutionMode = useCallback(
		async (mode: string) => {
			const nextMode = mode as SessionExecutionMode;
			if (nextMode === executionMode) return;
			if (nextMode === "sandbox" && sandboxUnavailableReason) return;
			const previousMode = executionMode;
			setExecutionMode(nextMode);
			localStorage.setItem("vetta-session-execution-mode", nextMode);
			try {
				await window.vetta.config.set({ defaultExecutionMode: nextMode });
				recordSettingsUsage({ tab: "general", action: "changed", target: "execution-mode", value: nextMode });
			} catch (error) {
				setExecutionMode(previousMode);
				localStorage.setItem("vetta-session-execution-mode", previousMode);
				console.error("[GeneralSettings] failed to switch execution mode:", error);
			}
		},
		[executionMode, sandboxUnavailableReason, setExecutionMode],
	);

	const startAppGuide = useCallback(() => {
		openSetupWizard();
		recordSettingsUsage({ tab: "general", action: "selected", target: "setup-guide" });
	}, []);

	const labels = useMemo<GeneralSettingsLabels>(
		() => ({
			debugMode: t("debugMode"),
			debugModeDescription: t("debugModeDescription"),
			export: t("export"),
			exportDiagnostics: t("exportDiagnostics"),
			exportDiagnosticsDescription: t("exportDiagnosticsDescription"),
			exporting: t("exporting"),
			fullAccess: t("fullAccess"),
			reset: t("reset"),
			sandboxDescription: t("sandboxDescription"),
			sandboxTitle: t("sandbox.title"),
			sections: {
				app: t(SETTINGS_SECTION["general-app"].titleKey),
				basics: t(SETTINGS_SECTION["general-basics"].titleKey),
				developer: t(SETTINGS_SECTION["general-developer"].titleKey),
				notifications: t(SETTINGS_SECTION["general-notifications"].titleKey),
			},
			appVersion: t("appVersion"),
			startAppGuide: t("startAppGuide"),
			startAppGuideAction: t("startAppGuideAction"),
			startAppGuideDescription: t("startAppGuideDescription"),
			systemNotifications: t("systemNotifications"),
			systemNotificationsDescription: t("systemNotificationsDescription"),
			notificationSound: t("notificationSound"),
			notificationSoundDescription: t("notificationSoundDescription"),
			notificationSystemTiming: t("notificationSystemTiming"),
			notificationSoundTiming: t("notificationSoundTiming"),
			notificationSoundVolume: t("notificationSoundVolume"),
			notificationEvents: t("notificationEvents"),
			notificationEventCompleted: t("notificationEventCompleted"),
			notificationEventFailed: t("notificationEventFailed"),
			notificationEventActionRequired: t("notificationEventActionRequired"),
			notificationSystemBanner: t("notificationSystemBanner"),
			notificationPreview: t("notificationPreview"),
			notificationPreviewAction: t("notificationPreviewAction"),
			notificationNoSound: t("notificationNoSound"),
			notificationScopes: {
				"background-only": t("notificationScopeBackground"),
				"away-from-session": t("notificationScopeAway"),
				always: t("notificationScopeAlways"),
			},
			notificationSounds: {
				"soft-chime": t("notificationSoundSoftChime"),
				"single-bell": t("notificationSoundSingleBell"),
				"wood-tap": t("notificationSoundWoodTap"),
				"digital-pulse": t("notificationSoundDigitalPulse"),
			},
			title: t("general"),
			useSandbox: t("useSandbox"),
			workspaceDescription: t("workspaceDescription"),
			workspaceTitle: t("workspace.title"),
		}),
		[t],
	);

	return {
		actions: {
			changeExecutionMode,
			exportDiagnostics,
			resetWorkspace,
			selectWorkspace,
			startAppGuide,
			toggleDebug,
			toggleNotifications,
			toggleSound: (enabled) => updateNotificationPreferences((current) => ({ ...current, soundEnabled: enabled })),
			changeNotificationSystemScope: (scope) =>
				updateNotificationPreferences((current) => ({ ...current, systemScope: scope })),
			changeNotificationSoundScope: (scope) =>
				updateNotificationPreferences((current) => ({ ...current, soundScope: scope })),
			changeNotificationSoundVolume: (soundVolume) =>
				updateNotificationPreferences((current) => ({ ...current, soundVolume })),
			changeNotificationEventSystem: (event, systemEnabled) =>
				changeNotificationEvent(event, (current) => ({ ...current, systemEnabled })),
			changeNotificationEventSound: (event, soundId) =>
				changeNotificationEvent(event, (current) => ({ ...current, soundId })),
			previewNotificationSound: (soundId?: BuiltinNotificationSoundId) =>
				void playNotificationSound(soundId ?? "soft-chime", notificationPreferences.soundVolume),
		},
		debugMode,
		executionMode,
		exportingDiagnostics,
		labels,
		notificationsEnabled,
		notificationPreferences,
		sandboxUnavailableReason,
		workspacePath,
	};
}
