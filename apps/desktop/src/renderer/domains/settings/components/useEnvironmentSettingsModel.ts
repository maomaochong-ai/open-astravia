import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

type RuntimesStatus = Awaited<ReturnType<typeof window.astravia.runtimes.getStatus>>;
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

/**
 * 把主进程的错误翻成用户能执行的话。
 *
 * `runtime-in-use` 是主进程在重试之后仍拿不到文件时的标记（Windows 上 `node.exe` 被
 * 正在跑的子进程占用）。原文是 `EPERM: operation not permitted, unlink …`，用户看不出
 * 「关掉再用」这一层，所以在这里换掉。
 */
function messageOf(err: unknown, t: TFunction<"settings">): string {
	const raw = err instanceof Error ? err.message : String(err);
	if (raw.includes("runtime-in-use")) return t("environmentRuntimeInUse");
	return raw;
}

export function useEnvironmentSettingsModel(): EnvironmentSettingsModel {
	const { t } = useTranslation("settings");
	const [status, setStatus] = useState<RuntimesStatus | null>(null);
	const [busy, setBusy] = useState<EnvironmentRuntimeKind | null>(null);
	const [gitBusy, setGitBusy] = useState<EnvironmentSettingsModel["git"]["busy"]>(null);
	const [installerLaunched, setInstallerLaunched] = useState(false);
	const [commandCopied, setCommandCopied] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/*
	 * 翻译函数走 ref 而不是依赖项：`t` 的引用一旦变化，`refresh` 就是新回调，
	 * 「挂载即刷新」的 effect 会重新触发、把刚拿到的状态覆盖回去（实测会让
	 * 「重新检测」的结果被一次迟到的 getStatus 冲掉）。错误文案只在出错分支读它。
	 */
	const tRef = useRef(t);
	tRef.current = t;

	const refresh = useCallback(async () => {
		try {
			setStatus(await window.astravia.runtimes.getStatus());
		} catch (err) {
			setError(messageOf(err, tRef.current));
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
				await window.astravia.runtimes.reinstall(kind);
				await refresh();
				recordSettingsUsage({ tab: "environment", action: "reinstalled", target: "runtime", value: kind });
			} catch (err) {
				setError(messageOf(err, tRef.current));
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
			const git = await window.astravia.runtimes.installGit();
			setStatus((prev) => (prev ? { ...prev, git } : prev));
			if (guide === "xcode-clt") setInstallerLaunched(true);
			recordSettingsUsage({ tab: "environment", action: "added", target: "git", value: guide ?? "unknown" });
		} catch (err) {
			setError(messageOf(err, tRef.current));
		} finally {
			setGitBusy(null);
		}
	}, [status]);

	const redetect = useCallback(async () => {
		setGitBusy("detect");
		setError(null);
		try {
			setStatus(await window.astravia.runtimes.redetect());
		} catch (err) {
			setError(messageOf(err, tRef.current));
		} finally {
			setGitBusy(null);
		}
	}, []);

	const copyGitCommand = useCallback(async (command: string) => {
		try {
			await navigator.clipboard.writeText(command);
			setCommandCopied(true);
		} catch (err) {
			setError(messageOf(err, tRef.current));
		}
	}, []);

	const openGitDownload = useCallback(() => {
		void window.astravia.shell
			.openExternal(GIT_DOWNLOAD_URL)
			.catch((err: unknown) => setError(messageOf(err, tRef.current)));
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
