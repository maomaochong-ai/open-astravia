import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

type RuntimesStatus = Awaited<ReturnType<typeof window.vetta.runtimes.getStatus>>;
export type EnvironmentRuntimeStatus = RuntimesStatus["node"];
export type EnvironmentRuntimeKind = "node" | "python";

/** Git 官方下载页；macOS 与 Linux 之外的平台也从这里挑安装包。 */
export const GIT_DOWNLOAD_URL = "https://git-scm.com/downloads";

export interface EnvironmentSettingsModel {
	actions: {
		copyGitCommand: (command: string) => Promise<void>;
		installGit: () => Promise<void>;
		openGitDownload: () => void;
		redetect: () => Promise<void>;
		reinstall: (kind: EnvironmentRuntimeKind) => Promise<void>;
	};
	busy: EnvironmentRuntimeKind | null;
	error: string | null;
	git: {
		busy: "detect" | "install" | null;
		commandCopied: boolean;
		/** macOS 已调起系统安装窗口，提示用户装好后重新检测。 */
		installerLaunched: boolean;
	};
	labels: {
		description: string;
		fetch: string;
		fetchAgain: string;
		fetching: string;
		git: {
			copied: string;
			copy: string;
			description: string;
			detecting: string;
			download: string;
			installManaged: string;
			installXcode: string;
			installing: string;
			managedHint: string;
			managedSuffix: string;
			manualHint: string;
			missing: string;
			packageManagerFallback: string;
			packageManagerHint: string;
			ready: string;
			redetect: string;
			xcodeHint: string;
			xcodeLaunched: string;
		};
		loading: string;
		notReady: string;
		npmRegistry: string;
		npmRegistryDescription: string;
		pipIndex: string;
		pipIndexDescription: string;
		platformNotSupported: string;
		ready: string;
		runtimeDescriptions: Record<EnvironmentRuntimeKind, string>;
		sections: {
			mirrors: string;
			runtime: string;
			tools: string;
		};
		title: string;
	};
	status: RuntimesStatus | null;
}

function messageOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export function useEnvironmentSettingsModel(): EnvironmentSettingsModel {
	const { t } = useTranslation("settings");
	const [status, setStatus] = useState<RuntimesStatus | null>(null);
	const [busy, setBusy] = useState<EnvironmentRuntimeKind | null>(null);
	const [gitBusy, setGitBusy] = useState<EnvironmentSettingsModel["git"]["busy"]>(null);
	const [installerLaunched, setInstallerLaunched] = useState(false);
	const [commandCopied, setCommandCopied] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			setStatus(await window.vetta.runtimes.getStatus());
		} catch (err) {
			setError(messageOf(err));
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const reinstall = useCallback(
		async (kind: EnvironmentRuntimeKind) => {
			setBusy(kind);
			setError(null);
			try {
				await window.vetta.runtimes.reinstall(kind);
				await refresh();
				recordSettingsUsage({ tab: "environment", action: "reinstalled", target: "runtime", value: kind });
			} catch (err) {
				setError(messageOf(err));
			} finally {
				setBusy(null);
			}
		},
		[refresh],
	);

	const installGit = useCallback(async () => {
		const guide = status?.git.install.kind;
		setGitBusy("install");
		setError(null);
		try {
			const git = await window.vetta.runtimes.installGit();
			setStatus((prev) => (prev ? { ...prev, git } : prev));
			if (guide === "xcode-clt") setInstallerLaunched(true);
			recordSettingsUsage({ tab: "environment", action: "added", target: "git", value: guide ?? "unknown" });
		} catch (err) {
			setError(messageOf(err));
		} finally {
			setGitBusy(null);
		}
	}, [status]);

	const redetect = useCallback(async () => {
		setGitBusy("detect");
		setError(null);
		try {
			setStatus(await window.vetta.runtimes.redetect());
		} catch (err) {
			setError(messageOf(err));
		} finally {
			setGitBusy(null);
		}
	}, []);

	const copyGitCommand = useCallback(async (command: string) => {
		try {
			await navigator.clipboard.writeText(command);
			setCommandCopied(true);
		} catch (err) {
			setError(messageOf(err));
		}
	}, []);

	const openGitDownload = useCallback(() => {
		void window.vetta.shell.openExternal(GIT_DOWNLOAD_URL).catch((err: unknown) => setError(messageOf(err)));
	}, []);

	const labels = useMemo<EnvironmentSettingsModel["labels"]>(
		() => ({
			description: t("environmentDescription"),
			fetch: t("fetch"),
			fetchAgain: t("fetchAgain"),
			fetching: t("fetching"),
			git: {
				copied: t("environmentGit.copied"),
				copy: t("environmentGit.copy"),
				description: t("environmentGit.description"),
				detecting: t("environmentGit.detecting"),
				download: t("environmentGit.download"),
				installManaged: t("environmentGit.installManaged"),
				installXcode: t("environmentGit.installXcode"),
				installing: t("environmentGit.installing"),
				managedHint: t("environmentGit.managedHint"),
				managedSuffix: t("environmentGit.managedSuffix"),
				manualHint: t("environmentGit.manualHint"),
				missing: t("environmentGit.missing"),
				packageManagerFallback: t("environmentGit.packageManagerFallback"),
				packageManagerHint: t("environmentGit.packageManagerHint"),
				ready: t("ready"),
				redetect: t("environmentGit.redetect"),
				xcodeHint: t("environmentGit.xcodeHint"),
				xcodeLaunched: t("environmentGit.xcodeLaunched"),
			},
			loading: t("loading"),
			notReady: t("notReady"),
			npmRegistry: t("npmRegistry"),
			npmRegistryDescription: t("npmRegistryDesc"),
			pipIndex: t("pipIndex"),
			pipIndexDescription: t("pipIndexDesc"),
			platformNotSupported: t("platformNotSupported"),
			ready: t("ready"),
			runtimeDescriptions: {
				node: t("environmentNodeDesc"),
				python: t("environmentPythonDesc"),
			},
			sections: {
				mirrors: t(SETTINGS_SECTION["environment-mirrors"].titleKey),
				runtime: t(SETTINGS_SECTION["environment-runtime"].titleKey),
				tools: t(SETTINGS_SECTION["environment-tools"].titleKey),
			},
			title: t("environment"),
		}),
		[t],
	);

	return {
		actions: { copyGitCommand, installGit, openGitDownload, redetect, reinstall },
		busy,
		error,
		git: { busy: gitBusy, commandCopied, installerLaunched },
		labels,
		status,
	};
}
