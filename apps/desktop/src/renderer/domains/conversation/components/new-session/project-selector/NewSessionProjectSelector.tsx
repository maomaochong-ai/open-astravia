import { useProjectActions } from "@domains/project/hooks/useProjects";
import { NewProjectDialog } from "@shared/components/NewProjectDialog";
import { isDuplicateProjectName } from "@shared/lib/project-name";
import { ProjectSelectorView } from "@vetta/theme-ui/chat";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	filterProjects,
	moveHighlight,
	type ProjectOption,
	type ProjectSelection,
	shouldShowSearch,
} from "./project-selection";

interface NewSessionProjectSelectorProps {
	readonly selection: ProjectSelection;
	readonly options: readonly ProjectOption[];
	readonly takenNames: readonly string[];
	/** 发送流程正在创建待建项目：trigger 换成「正在创建」并停止交互。 */
	readonly creating: boolean;
	readonly onSelectProject: (cwd: string | null) => void;
	readonly onSelectPendingProject: (name: string) => void;
	readonly className?: string;
}

/** Desktop adapter：状态、i18n 与项目动作在这里，纯展示交给 theme-ui。 */
export function NewSessionProjectSelector({
	selection,
	options,
	takenNames,
	creating,
	onSelectProject,
	onSelectPendingProject,
	className,
}: NewSessionProjectSelectorProps): JSX.Element {
	const { t } = useTranslation("chat");
	const { openProject } = useProjectActions();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [highlightIndex, setHighlightIndex] = useState(-1);
	const [showNewProject, setShowNewProject] = useState(false);

	const searchVisible = shouldShowSearch(options.length);
	const visibleOptions = useMemo(
		() => (searchVisible ? filterProjects(options, query) : options),
		[options, query, searchVisible],
	);

	const handleOpenChange = useCallback((next: boolean) => {
		setOpen(next);
		if (!next) {
			setQuery("");
			setHighlightIndex(-1);
		}
	}, []);

	const handleSelect = useCallback(
		(cwd: string | null) => {
			onSelectProject(cwd);
			handleOpenChange(false);
		},
		[onSelectProject, handleOpenChange],
	);

	const handleCommitHighlight = useCallback(() => {
		const target = visibleOptions[highlightIndex] ?? (visibleOptions.length === 1 ? visibleOptions[0] : undefined);
		if (!target) return;
		handleSelect(target.cwd);
	}, [visibleOptions, highlightIndex, handleSelect]);

	const handleOpenProject = useCallback(() => {
		handleOpenChange(false);
		void openProject().then((cwd) => {
			if (cwd) onSelectProject(cwd);
		});
	}, [handleOpenChange, openProject, onSelectProject]);

	const selectedName = selection?.name ?? null;

	return (
		<>
			<ProjectSelectorView
				className={className}
				open={open}
				options={visibleOptions.map((option) => ({
					cwd: option.cwd,
					name: option.name,
					selected: selection?.kind === "project" && selection.cwd === option.cwd,
				}))}
				labels={{
					placeholder: t("newSession.projectSelector.placeholder"),
					clear: t("newSession.projectSelector.clear"),
					searchPlaceholder: t("newSession.projectSelector.searchPlaceholder"),
					empty: t("newSession.projectSelector.empty"),
					newProject: t("newSession.projectSelector.newProject"),
					openProject: t("newSession.projectSelector.openProject"),
					pendingHint: t("newSession.projectSelector.pendingHint"),
					creating: t("newSession.projectSelector.creating"),
					triggerTitle: t("newSession.projectSelector.triggerTitle"),
				}}
				selectedName={selectedName}
				pendingCreate={selection?.kind === "pending-create"}
				creating={creating}
				searchVisible={searchVisible}
				query={query}
				highlightIndex={highlightIndex}
				onOpenChange={handleOpenChange}
				onQueryChange={(next) => {
					setQuery(next);
					setHighlightIndex(-1);
				}}
				onHighlightMove={(delta) =>
					setHighlightIndex((current) => moveHighlight(current, delta, visibleOptions.length))
				}
				onSelect={handleSelect}
				onCommitHighlight={handleCommitHighlight}
				onCreateProject={() => {
					handleOpenChange(false);
					setShowNewProject(true);
				}}
				onOpenProject={handleOpenProject}
			/>
			{showNewProject && (
				<NewProjectDialog
					onConfirm={(name) => {
						setShowNewProject(false);
						// 这里只登记意向：目录与 config 要等用户真的发出第一条消息时才落盘。
						onSelectPendingProject(name);
					}}
					onCancel={() => setShowNewProject(false)}
					isNameTaken={(name) => isDuplicateProjectName(name, takenNames)}
				/>
			)}
		</>
	);
}
