import type { SessionExecutionMode } from "@shared/store/atoms";
import type { BatchProjectRuntimeFieldsLabels } from "@vetta/theme-ui/batch-tasks";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { normalizeConcurrency, normalizeTimeout } from "../utils/batchProjectFormData";

export interface BatchProjectRuntimeFieldsModel {
	concurrency: number;
	executionModeValue: string;
	labels: BatchProjectRuntimeFieldsLabels;
	modelSelectPlaceholder: string;
	sandboxInheritLabel: string;
	fullAccessLabel: string;
	useSandboxLabel: string;
	timeoutMinutes: number;
}

export function useBatchProjectRuntimeFieldsModel(input: {
	concurrency: number | undefined;
	defaultExecutionMode: SessionExecutionMode;
	executionMode: string | undefined;
	timeoutMinutes: number | undefined;
}): BatchProjectRuntimeFieldsModel {
	const { t } = useTranslation("batch-tasks");

	const sandboxLabels = useMemo(() => {
		const useSandbox = t("form.useSandbox");
		const fullAccess = t("form.fullAccess");
		const modeLabel = input.defaultExecutionMode === "sandbox" ? useSandbox : fullAccess;
		return {
			useSandbox,
			fullAccess,
			sandboxInherit: t("form.sandboxInherit", { mode: modeLabel }),
		};
	}, [input.defaultExecutionMode, t]);

	const labels = useMemo<BatchProjectRuntimeFieldsLabels>(
		() => ({
			model: t("form.model"),
			concurrency: t("form.concurrency"),
			timeout: t("form.timeout"),
			timeoutHint: t("form.timeoutHint"),
			sandbox: t("form.sandbox"),
		}),
		[t],
	);

	return {
		concurrency: normalizeConcurrency(input.concurrency),
		executionModeValue: input.executionMode ?? "full-access",
		labels,
		modelSelectPlaceholder: t("form.modelSelect"),
		sandboxInheritLabel: sandboxLabels.sandboxInherit,
		fullAccessLabel: sandboxLabels.fullAccess,
		useSandboxLabel: sandboxLabels.useSandbox,
		timeoutMinutes: normalizeTimeout(input.timeoutMinutes),
	};
}
