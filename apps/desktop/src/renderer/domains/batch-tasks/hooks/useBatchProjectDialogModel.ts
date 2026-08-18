import type { ModelsConfigData } from "@preload/api";
import type { BatchProject } from "@shared/store/atoms";
import { remoteProvidersAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import type { BatchProjectEditableData } from "../components/BatchProjectFormFields";
import { normalizeConcurrency, normalizeTimeout, toBatchProjectApprovalJsonData } from "../utils/batchProjectFormData";
import { useBatchTasks } from "./useBatchTasks";

export interface BatchProjectDialogModel {
	canSubmit: boolean;
	data: BatchProjectEditableData;
	namePlaceholderKey: "dialog.namePlaceholderEdit" | "dialog.namePlaceholderNew";
	submitLabelKey: "dialog.save" | "dialog.create";
	titleKey: "dialog.editTitle" | "dialog.newTitle";
	setData: (data: BatchProjectEditableData) => void;
	submit: () => Promise<void>;
}

function getProjectData(project: BatchProject | undefined): BatchProjectEditableData {
	return {
		name: project?.name ?? "",
		prompt: project?.prompt ?? "",
		modelKey: project?.modelKey,
		executionMode: project?.executionMode ?? "full-access",
		concurrency: project?.concurrency ?? 1,
		timeoutMinutes: project?.timeoutMinutes ?? 60,
		folders: project?.tasks.map((task) => task.sourcePath) ?? [],
		artifactPatterns: project?.artifactPatterns ?? [],
		notifyEnabled: project?.notifyEnabled ?? false,
		skill: project?.skill ?? null,
	};
}

function flattenModelKeys(config: ModelsConfigData, remoteProviders: ModelsConfigData["providers"]): string[] {
	const localKeys = Object.entries(config.providers).flatMap(([provider, providerConfig]) =>
		(providerConfig.models ?? []).map((model) => `${provider}/${model.id}`),
	);
	const localKeySet = new Set(localKeys);
	const remoteKeys = Object.entries(remoteProviders).flatMap(([provider, providerConfig]) =>
		(providerConfig.models ?? []).map((model) => `${provider}/${model.id}`).filter((key) => !localKeySet.has(key)),
	);
	return [...localKeys, ...remoteKeys];
}

export function useBatchProjectDialogModel({
	open,
	project,
	onClose,
}: {
	open: boolean;
	project?: BatchProject;
	onClose: () => void;
}): BatchProjectDialogModel {
	const { createProject, updateProject } = useBatchTasks();
	const remoteProviders = useAtomValue(remoteProvidersAtom);
	const [data, setData] = useState<BatchProjectEditableData>(() => getProjectData(project));

	useEffect(() => {
		setData(getProjectData(project));
	}, [project]);

	useEffect(() => {
		if (!open) return;
		void window.vetta.models.get().then((config) => {
			const allModelKeys = flattenModelKeys(config, remoteProviders as ModelsConfigData["providers"]);
			const currentSelected = localStorage.getItem("vetta-selected-model") ?? undefined;
			const fallback = project?.modelKey ?? currentSelected ?? config.defaultModel;
			setData((current) => {
				if (current.modelKey && allModelKeys.includes(current.modelKey)) return current;
				if (fallback && allModelKeys.includes(fallback)) return { ...current, modelKey: fallback };
				return allModelKeys[0] ? { ...current, modelKey: allModelKeys[0] } : { ...current, modelKey: undefined };
			});
		});
	}, [open, project?.modelKey, remoteProviders]);

	const canSubmit = useMemo(
		() => Boolean(data.name?.trim() && data.prompt?.trim() && (data.folders?.length ?? 0) > 0),
		[data.folders?.length, data.name, data.prompt],
	);

	const submit = async (): Promise<void> => {
		if (!canSubmit) return;
		const normalized = toBatchProjectApprovalJsonData(data);
		const artifactPatterns = normalized.artifactPatterns ?? [];
		const safeTimeoutMinutes = normalizeTimeout(normalized.timeoutMinutes);
		const concurrency = normalizeConcurrency(normalized.concurrency);

		if (project) {
			const originalSources = new Set(project.tasks.map((task) => task.sourcePath));
			const newFolders = (normalized.folders ?? []).filter((folder) => !originalSources.has(folder));
			await updateProject(project.id, {
				name: normalized.name ?? "",
				prompt: normalized.prompt ?? "",
				modelKey: normalized.modelKey,
				executionMode: normalized.executionMode,
				concurrency,
				artifactPatterns,
				notifyEnabled: normalized.notifyEnabled ?? false,
				timeoutMinutes: safeTimeoutMinutes,
				newFolders,
				skill: normalized.skill ?? null,
			});
		} else {
			await createProject({
				name: normalized.name ?? "",
				prompt: normalized.prompt ?? "",
				modelKey: normalized.modelKey,
				executionMode: normalized.executionMode,
				folders: normalized.folders ?? [],
				concurrency,
				artifactPatterns,
				notifyEnabled: normalized.notifyEnabled ?? false,
				timeoutMinutes: safeTimeoutMinutes,
				skill: normalized.skill ?? undefined,
			});
		}
		onClose();
	};

	return {
		canSubmit,
		data,
		namePlaceholderKey: project ? "dialog.namePlaceholderEdit" : "dialog.namePlaceholderNew",
		submitLabelKey: project ? "dialog.save" : "dialog.create",
		titleKey: project ? "dialog.editTitle" : "dialog.newTitle",
		setData,
		submit,
	};
}
