import { showToast } from "@shared/store/atoms";
import type { Transport } from "@vetta/ai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { recordSettingsUsage } from "./recordSettingsUsage";

export interface ModelTransportSettingsModel {
	transport: Transport;
	loading: boolean;
	saving: boolean;
	options: readonly { value: Transport; label: string }[];
	labels: {
		title: string;
		description: string;
		rowTitle: string;
		rowDescription: string;
	};
	actions: {
		setTransport: (transport: Transport) => Promise<void>;
	};
}

export function useModelTransportSettingsModel(): ModelTransportSettingsModel {
	const { t } = useTranslation("settings");
	const [transport, setTransport] = useState<Transport>("sse");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void window.vetta.settings
			.getModelTransport()
			.then((value) => {
				if (!cancelled) setTransport(value);
			})
			.catch(() => {
				if (!cancelled) showToast({ variant: "error", message: t("modelSettings.transportLoadFailed") });
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [t]);

	const setConfiguredTransport = useCallback(
		async (value: Transport): Promise<void> => {
			if (value === transport || saving) return;
			const previous = transport;
			setTransport(value);
			setSaving(true);
			try {
				const saved = await window.vetta.settings.setModelTransport(value);
				setTransport(saved);
				recordSettingsUsage({ tab: "models", action: "changed", target: "transport", value: saved });
			} catch {
				setTransport(previous);
				showToast({ variant: "error", message: t("modelSettings.transportSaveFailed") });
			} finally {
				setSaving(false);
			}
		},
		[saving, t, transport],
	);

	const options = useMemo(
		() => [
			{ value: "sse" as const, label: t("modelSettings.transportSse") },
			{ value: "websocket" as const, label: t("modelSettings.transportWebSocket") },
			{ value: "auto" as const, label: t("modelSettings.transportAuto") },
		],
		[t],
	);

	return {
		transport,
		loading,
		saving,
		options,
		labels: {
			title: t("modelSettings.transportTitle"),
			description: t("modelSettings.transportDescription"),
			rowTitle: t("modelSettings.transportLabel"),
			rowDescription: t(`modelSettings.transportDescriptions.${transport}`),
		},
		actions: { setTransport: setConfiguredTransport },
	};
}
