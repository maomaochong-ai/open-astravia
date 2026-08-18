import type { SessionExecutionMode } from "@shared/store/atoms";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BatchProjectEditableData } from "../components/BatchProjectFormFields";
import { compactLines, normalizeConcurrency, normalizeTimeout } from "../utils/batchProjectFormData";

export interface BatchProjectFormFieldsModel {
	artifactPatternsText: string;
	defaultExecutionMode: SessionExecutionMode;
	folderInputMode: "picker" | "textarea";
	folderText: string;
	folders: string[];
	sandboxUnavailableReason: string | null;
	selectFolders: () => void;
	removeFolder: (folder: string) => void;
	setField: <Key extends keyof BatchProjectEditableData>(key: Key, nextValue: BatchProjectEditableData[Key]) => void;
	setFolderInputMode: (mode: "picker" | "textarea") => void;
	updateFolderText: (nextValue: string) => void;
	value: BatchProjectEditableData;
}

export function useBatchProjectFormFieldsModel({
	folderField,
	onChange,
	value,
}: {
	folderField: "folders" | "newFolders";
	onChange: (value: BatchProjectEditableData) => void;
	value: BatchProjectEditableData;
}): BatchProjectFormFieldsModel {
	const { t } = useTranslation("batch-tasks");
	const [defaultExecutionMode, setDefaultExecutionMode] = useState<SessionExecutionMode>("full-access");
	const [sandboxUnavailableReason, setSandboxUnavailableReason] = useState<string | null>(null);
	const [folderInputMode, setFolderInputMode] = useState<"picker" | "textarea">("picker");

	const setField = useCallback(
		<Key extends keyof BatchProjectEditableData>(key: Key, nextValue: BatchProjectEditableData[Key]): void => {
			onChange({ ...value, [key]: nextValue });
		},
		[onChange, value],
	);

	const folders = value[folderField] ?? [];

	useEffect(() => {
		void window.vetta.config.get().then((desktopConfig) => {
			setDefaultExecutionMode(desktopConfig.defaultExecutionMode ?? "full-access");
			const capability = desktopConfig.sandbox ?? desktopConfig.linuxSandbox;
			if (capability?.status === "unavailable") {
				const reason = capability.reason ?? "unknown_error";
				const platform = "platform" in capability ? capability.platform : "linux";
				setSandboxUnavailableReason(t("form.sandboxUnavailable", { platform, reason }));
				return;
			}
			setSandboxUnavailableReason(null);
		});
	}, [t]);

	const selectFolders = useCallback(() => {
		void (async () => {
			const selected = await window.vetta.dialog.selectFolders();
			if (selected.length > 0) {
				setField(folderField, compactLines([...folders, ...selected]));
			}
		})();
	}, [folderField, folders, setField]);

	const updateFolderText = useCallback(
		(nextValue: string) => {
			setField(folderField, compactLines(nextValue.split(/\r?\n/)));
		},
		[folderField, setField],
	);

	const removeFolder = useCallback(
		(folder: string) => {
			setField(
				folderField,
				folders.filter((candidate) => candidate !== folder),
			);
		},
		[folderField, folders, setField],
	);

	return {
		artifactPatternsText: (value.artifactPatterns ?? []).join("\n"),
		defaultExecutionMode,
		folderInputMode,
		folderText: folders.join("\n"),
		folders,
		sandboxUnavailableReason,
		selectFolders,
		removeFolder,
		setField,
		setFolderInputMode,
		updateFolderText,
		value: {
			...value,
			concurrency: normalizeConcurrency(value.concurrency),
			timeoutMinutes: normalizeTimeout(value.timeoutMinutes),
		},
	};
}
