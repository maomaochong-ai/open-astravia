import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

type RuntimesStatus = Awaited<ReturnType<typeof window.vetta.runtimes.getStatus>>;
export type EnvironmentRuntimeStatus = RuntimesStatus["node"];
export type EnvironmentRuntimeKind = "node" | "python";

export interface EnvironmentSettingsModel {
	actions: {
		reinstall: (kind: EnvironmentRuntimeKind) => Promise<void>;
	};
	busy: EnvironmentRuntimeKind | null;
	error: string | null;
	labels: {
		description: string;
		fetch: string;
		fetchAgain: string;
		fetching: string;
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
		};
		title: string;
	};
	status: RuntimesStatus | null;
}

export function useEnvironmentSettingsModel(): EnvironmentSettingsModel {
	const { t } = useTranslation("settings");
	const [status, setStatus] = useState<RuntimesStatus | null>(null);
	const [busy, setBusy] = useState<EnvironmentRuntimeKind | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			setStatus(await window.vetta.runtimes.getStatus());
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
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
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				setBusy(null);
			}
		},
		[refresh],
	);

	const labels = useMemo<EnvironmentSettingsModel["labels"]>(
		() => ({
			description: t("environmentDescription"),
			fetch: t("fetch"),
			fetchAgain: t("fetchAgain"),
			fetching: t("fetching"),
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
			},
			title: t("environment"),
		}),
		[t],
	);

	return {
		actions: { reinstall },
		busy,
		error,
		labels,
		status,
	};
}
