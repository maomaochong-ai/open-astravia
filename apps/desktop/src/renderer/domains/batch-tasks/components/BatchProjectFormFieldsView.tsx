import type { BatchProjectFormFieldsModel } from "../hooks/useBatchProjectFormFieldsModel";
import { BatchProjectArtifactField } from "./batch-project-form/BatchProjectArtifactField";
import { BatchProjectFoldersField } from "./batch-project-form/BatchProjectFoldersField";
import { BatchProjectNameField } from "./batch-project-form/BatchProjectNameField";
import { BatchProjectNotificationField } from "./batch-project-form/BatchProjectNotificationField";
import { BatchProjectPromptField } from "./batch-project-form/BatchProjectPromptField";
import { BatchProjectRuntimeFields } from "./batch-project-form/BatchProjectRuntimeFields";

interface BatchProjectFormFieldsViewProps {
	folderEmptyText: string;
	folderLabel: string;
	model: BatchProjectFormFieldsModel;
	namePlaceholder: string;
	promptMinHeight: number;
	showFolders: boolean;
}

export function BatchProjectFormFieldsView({
	folderEmptyText,
	folderLabel,
	model,
	namePlaceholder,
	promptMinHeight,
	showFolders,
}: BatchProjectFormFieldsViewProps): JSX.Element {
	const value = model.value;

	return (
		<div className="space-y-4">
			<BatchProjectNameField
				name={value.name ?? ""}
				onChange={(name) => model.setField("name", name)}
				placeholder={namePlaceholder}
			/>

			<BatchProjectPromptField
				prompt={value.prompt ?? ""}
				onPromptChange={(prompt) => model.setField("prompt", prompt)}
				promptMinHeight={promptMinHeight}
				skill={value.skill ?? null}
				onSkillChange={(skill) => model.setField("skill", skill)}
			/>

			<BatchProjectRuntimeFields
				concurrency={value.concurrency}
				defaultExecutionMode={model.defaultExecutionMode}
				executionMode={value.executionMode}
				modelKey={value.modelKey}
				sandboxUnavailableReason={model.sandboxUnavailableReason}
				timeoutMinutes={value.timeoutMinutes}
				onConcurrencyChange={(concurrency) => model.setField("concurrency", concurrency)}
				onExecutionModeChange={(executionMode) => model.setField("executionMode", executionMode)}
				onModelKeyChange={(modelKey) => model.setField("modelKey", modelKey)}
				onTimeoutChange={(timeoutMinutes) => model.setField("timeoutMinutes", timeoutMinutes)}
			/>

			<BatchProjectNotificationField
				checked={value.notifyEnabled ?? false}
				onChange={(checked) => model.setField("notifyEnabled", checked)}
			/>

			<BatchProjectArtifactField
				value={model.artifactPatternsText}
				onChange={(artifactPatterns) => model.setField("artifactPatterns", artifactPatterns)}
			/>

			{showFolders && (
				<BatchProjectFoldersField
					emptyText={folderEmptyText}
					folderInputMode={model.folderInputMode}
					folderText={model.folderText}
					folders={model.folders}
					label={folderLabel}
					onFolderTextChange={model.updateFolderText}
					onInputModeChange={model.setFolderInputMode}
					onRemoveFolder={model.removeFolder}
					onSelectFolders={model.selectFolders}
				/>
			)}
		</div>
	);
}
