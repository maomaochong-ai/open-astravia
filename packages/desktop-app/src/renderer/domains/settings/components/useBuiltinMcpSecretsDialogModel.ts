import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type BuiltinMcpPreset,
	resolveMcpPresetDisplayName,
	resolveMcpPresetIconUrl,
} from "../mcp/builtin-mcp-presets";

function resolvePrimaryHelpUrl(preset: BuiltinMcpPreset): string | undefined {
	if (preset.setupHelpUrl) return preset.setupHelpUrl;
	return preset.secrets?.find((field) => field.helpUrl)?.helpUrl;
}

export interface BuiltinMcpSecretsFieldView {
	readonly envKey: string;
	readonly helpUrl?: string;
	readonly label: string;
	readonly optionalSuffix: string;
	readonly placeholder?: string;
	readonly required: boolean;
	readonly secret: boolean;
}

export interface BuiltinMcpSecretsDialogModel {
	readonly appIconUrl: string;
	readonly canSubmit: boolean;
	readonly connectorIconUrl: string;
	readonly connectorName: string;
	readonly fields: readonly BuiltinMcpSecretsFieldView[];
	readonly guideLines: readonly string[];
	readonly hasFields: boolean;
	readonly labels: {
		readonly continueCta: string;
		readonly getKey: string;
		readonly openAuthPage: string;
		readonly openKeyPage: string;
		readonly privacyTooltip: string;
		readonly privacyTooltipAria: string;
		readonly saving: string;
		readonly authorizing: string;
		readonly setupBody: string;
		readonly setupTitle: string;
		readonly stepPasteKey: string;
		readonly title: string;
	};
	readonly onChangeValue: (envKey: string, value: string) => void;
	readonly onOpenHelp: (url: string) => void;
	readonly open: boolean;
	readonly primaryHelpUrl?: string;
	readonly saving: boolean;
	readonly authorizing: boolean;
	readonly error: string | null;
	readonly values: Record<string, string>;
}

export function useBuiltinMcpSecretsDialogModel({
	open,
	preset,
	initialValues,
	saving = false,
	authorizing = false,
	error = null,
}: {
	open: boolean;
	preset: BuiltinMcpPreset | null;
	initialValues?: Record<string, string>;
	saving?: boolean;
	authorizing?: boolean;
	error?: string | null;
}): BuiltinMcpSecretsDialogModel | null {
	const { t } = useTranslation("settings");
	const fields = preset?.secrets ?? [];
	const [values, setValues] = useState<Record<string, string>>({});

	useEffect(() => {
		if (!open || !preset) return;
		const next: Record<string, string> = {};
		for (const field of preset.secrets ?? []) {
			next[field.envKey] = initialValues?.[field.envKey] ?? "";
		}
		setValues(next);
	}, [initialValues, open, preset]);

	const canSubmit = useMemo(() => {
		return fields.every((field) => {
			if (!field.required) return true;
			return Boolean(values[field.envKey]?.trim());
		});
	}, [fields, values]);

	return useMemo(() => {
		if (!preset) return null;
		const guide = preset.setupGuide?.trim() || (preset.setupGuideKey ? t(preset.setupGuideKey) : "");
		const guideLines = guide
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		const hasFields = fields.length > 0;
		const connectorName = resolveMcpPresetDisplayName(preset, (key) => t(key));
		return {
			appIconUrl: "./icon.png",
			canSubmit,
			connectorIconUrl: resolveMcpPresetIconUrl(preset),
			connectorName,
			fields: fields.map((field) => ({
				envKey: field.envKey,
				helpUrl: field.helpUrl,
				label: field.label?.trim() || (field.labelKey ? t(field.labelKey) : field.envKey),
				optionalSuffix: `（${t("optional")}）`,
				placeholder: field.placeholder,
				required: Boolean(field.required),
				secret: Boolean(field.secret),
			})),
			guideLines,
			hasFields,
			labels: {
				continueCta: t("mcpPresets.continueCta", { name: connectorName }),
				getKey: t("mcpPresets.getKey"),
				openAuthPage: t("mcpPresets.openAuthPage"),
				openKeyPage: t("mcpPresets.openKeyPage"),
				privacyTooltip: t("mcpPresets.privacyTooltip"),
				privacyTooltipAria: t("mcpPresets.privacyTooltipAria"),
				saving: t("saving"),
				authorizing: t("mcpPresets.authorizing"),
				setupBody: hasFields ? t("mcpPresets.secretsDialogLead") : t("mcpPresets.browserAuthDialogLead"),
				setupTitle: t("mcpPresets.setupTitle"),
				stepPasteKey: t("mcpPresets.stepPasteKey"),
				title: t("mcpPresets.secretsDialogTitle", { name: connectorName }),
			},
			onChangeValue: (envKey: string, value: string) => {
				setValues((current) => ({ ...current, [envKey]: value }));
			},
			onOpenHelp: (url: string) => {
				void window.vetta.auth.openExternal(url);
			},
			open,
			primaryHelpUrl: resolvePrimaryHelpUrl(preset),
			saving,
			authorizing,
			error,
			values,
		};
	}, [authorizing, canSubmit, error, fields, open, preset, saving, t, values]);
}
