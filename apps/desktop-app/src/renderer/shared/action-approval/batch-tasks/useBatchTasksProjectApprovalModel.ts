import {
	type BatchProjectEditableData,
	toBatchProjectApprovalJsonData,
} from "@domains/batch-tasks/components/BatchProjectFormFields";
import type { DesktopActionApprovalRequest, DesktopActionJsonValue } from "@preload/api.js";
import { type BatchProject, batchProjectsAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useActionApproval } from "../useActionApproval";
import type { BatchTasksApprovalFrameViewProps } from "./BatchTasksApprovalFrameView";

type ProjectData = BatchProjectEditableData;

interface ProjectInput {
	operation: "create" | "update" | "delete";
	projectId?: string;
	data?: ProjectData;
	approvalUi?: string;
}

function mergeCurrentProjectData(input: ProjectInput | null, project: BatchProject | undefined): ProjectInput | null {
	if (input?.operation !== "update" || !project) return input;
	const currentFolders = project.tasks.map((task) => task.sourcePath);
	const folders = input.data?.folders ?? [...new Set([...currentFolders, ...(input.data?.newFolders ?? [])])];
	return {
		...input,
		data: {
			name: project.name,
			prompt: project.prompt,
			modelKey: project.modelKey,
			concurrency: project.concurrency,
			executionMode: project.executionMode,
			artifactPatterns: project.artifactPatterns ?? [],
			notifyEnabled: project.notifyEnabled ?? false,
			timeoutMinutes: project.timeoutMinutes ?? 60,
			skill: project.skill ?? null,
			...input.data,
			folders,
		},
	};
}

function getCurrentProject(projects: BatchProject[], projectId: string | undefined): BatchProject | undefined {
	return projectId ? projects.find((project) => project.id === projectId) : undefined;
}

function parseProjectInput(input: DesktopActionApprovalRequest["input"]): ProjectInput | null {
	if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
	const record = input as Record<string, unknown>;
	if (record.operation === "create" && isRecord(record.data)) {
		return {
			operation: "create",
			data: record.data as ProjectData,
			approvalUi: typeof record.approvalUi === "string" ? record.approvalUi : undefined,
		};
	}
	if (record.operation === "update" && typeof record.projectId === "string" && isRecord(record.data)) {
		return {
			operation: "update",
			projectId: record.projectId,
			data: record.data as ProjectData,
			approvalUi: typeof record.approvalUi === "string" ? record.approvalUi : undefined,
		};
	}
	if (record.operation === "delete" && typeof record.projectId === "string") {
		return {
			operation: "delete",
			projectId: record.projectId,
			approvalUi: typeof record.approvalUi === "string" ? record.approvalUi : undefined,
		};
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, DesktopActionJsonValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toEditableData(data: ProjectData | undefined): BatchProjectEditableData {
	return {
		name: data?.name ?? "",
		prompt: data?.prompt ?? "",
		modelKey: data?.modelKey,
		executionMode: data?.executionMode ?? "full-access",
		concurrency: data?.concurrency ?? 1,
		artifactPatterns: data?.artifactPatterns ?? [],
		notifyEnabled: data?.notifyEnabled ?? false,
		timeoutMinutes: data?.timeoutMinutes ?? 60,
		folders: data?.folders ?? [],
		newFolders: data?.newFolders ?? [],
		skill: data?.skill ?? null,
	};
}

function hasCreateRequiredData(data: BatchProjectEditableData): boolean {
	return Boolean(data.name?.trim() && data.prompt?.trim() && (data.folders?.length ?? 0) > 0);
}

function buildApprovedInput(
	input: ProjectInput,
	data: BatchProjectEditableData,
	currentProject: BatchProject | undefined,
): DesktopActionJsonValue {
	const normalized = toBatchProjectApprovalJsonData(data);
	if (input.operation === "create") {
		const { newFolders: _newFolders, skill, ...createData } = normalized;
		return {
			operation: "create",
			data: skill ? { ...createData, skill } : createData,
			approvalUi: input.approvalUi ?? "batch-tasks.project",
		} as DesktopActionJsonValue;
	}
	if (input.operation === "update") {
		const { folders: _folders, ...updateData } = normalized;
		const originalSources = new Set(currentProject?.tasks.map((task) => task.sourcePath) ?? []);
		const newFolders = (normalized.folders ?? []).filter((folder) => !originalSources.has(folder));
		return {
			operation: "update",
			projectId: input.projectId,
			data: { ...updateData, newFolders },
			approvalUi: input.approvalUi ?? "batch-tasks.project",
		} as DesktopActionJsonValue;
	}
	return input as unknown as DesktopActionJsonValue;
}

function getProjectOperationLabel(
	operation: ProjectInput["operation"],
	t: ReturnType<typeof useTranslation<"common">>["t"],
): string {
	switch (operation) {
		case "create":
			return t("batchTasksApproval.projectCreateLabel");
		case "update":
			return t("batchTasksApproval.projectUpdateLabel");
		case "delete":
			return t("batchTasksApproval.projectDeleteLabel");
	}
}

function getProjectOperationDisplay(
	operation: ProjectInput["operation"],
	t: ReturnType<typeof useTranslation<"common">>["t"],
): { title: string; summary: string } {
	switch (operation) {
		case "create":
			return {
				title: t("batchTasksApproval.projectCreateTitle"),
				summary: t("batchTasksApproval.projectCreateSummary"),
			};
		case "update":
			return {
				title: t("batchTasksApproval.projectUpdateTitle"),
				summary: t("batchTasksApproval.projectUpdateSummary"),
			};
		case "delete":
			return {
				title: t("batchTasksApproval.projectDeleteTitle"),
				summary: t("batchTasksApproval.projectDeleteSummary"),
			};
	}
}

export type BatchTasksProjectApprovalPhase = "loading" | "not_found" | "ready";

export interface BatchTasksProjectApprovalModel {
	readonly approvalId: string;
	readonly phase: BatchTasksProjectApprovalPhase;
	readonly frame: Omit<BatchTasksApprovalFrameViewProps, "children"> | null;
	readonly loadingLabel: string;
	readonly loadError: string | null;
	readonly operation: ProjectInput["operation"] | null;
	readonly formData: BatchProjectEditableData;
	readonly onFormChange: (data: BatchProjectEditableData) => void;
	readonly currentProjectName: string;
	readonly projectPathLabel: string;
	readonly taskCountLabel: string;
	readonly notFoundLabel: string;
	readonly unknownLabel: string;
	readonly fullAccessWarning: string;
	readonly deleteWarning: string;
	readonly newProjectNamePlaceholder: string;
	readonly projectNamePlaceholder: string;
	readonly sourceFoldersLabel: string;
	readonly folderListLabel: string;
	readonly targetProjectLabel: string;
	readonly projectPathFieldLabel: string;
	readonly existingTasksLabel: string;
	readonly includedTasksLabel: string;
	readonly rawInput: unknown;
}

export function useBatchTasksProjectApprovalModel(): BatchTasksProjectApprovalModel | null {
	const approval = useActionApproval("batch-tasks.project");
	const projects = useAtomValue(batchProjectsAtom);
	const { t } = useTranslation("common");
	const parsedInput = useMemo(() => (approval ? parseProjectInput(approval.request.input) : null), [approval]);
	const cachedProject = getCurrentProject(projects, parsedInput?.projectId);
	const needsProject = parsedInput?.operation === "update" || parsedInput?.operation === "delete";
	const [currentProject, setCurrentProject] = useState<BatchProject | undefined>(cachedProject);
	const [loading, setLoading] = useState(needsProject && !cachedProject);
	const [loadError, setLoadError] = useState<string | null>(null);
	const input = useMemo(() => mergeCurrentProjectData(parsedInput, currentProject), [currentProject, parsedInput]);
	const initialFormData = useMemo(() => toEditableData(input?.data), [input?.data]);
	const [formData, setFormData] = useState<BatchProjectEditableData>(initialFormData);

	useEffect(() => {
		setCurrentProject(cachedProject);
		setLoading(needsProject && !cachedProject);
		setLoadError(null);
	}, [cachedProject, needsProject]);

	useEffect(() => {
		if (!approval) return;
		console.info(
			"[action-approval:batch-tasks.project] request " +
				JSON.stringify({
					approvalId: approval.request.approvalId,
					input: approval.request.input,
					parsedInput,
					cachedProject,
				}),
		);
	}, [approval, cachedProject, parsedInput]);

	useEffect(() => {
		if (!approval || !needsProject) return;
		if (cachedProject) {
			console.info(
				"[action-approval:batch-tasks.project] source " +
					JSON.stringify({
						approvalId: approval.request.approvalId,
						source: "atom",
						project: cachedProject,
					}),
			);
			return;
		}
		let cancelled = false;
		void window.vetta.batchTasks
			.getProjects()
			.then((listed) => {
				if (cancelled) return;
				const project = getCurrentProject(listed, parsedInput?.projectId);
				console.info(
					"[action-approval:batch-tasks.project] query " +
						JSON.stringify({
							approvalId: approval.request.approvalId,
							requestedProjectId: parsedInput?.projectId,
							returnedProjectIds: listed.map((candidate) => candidate.id),
							matchedProject: project,
						}),
				);
				setCurrentProject(project);
				if (!project) setLoadError(t("batchTasksApproval.projectLoadNotFound"));
			})
			.catch((queryError: unknown) => {
				console.error(
					"[action-approval:batch-tasks.project] query-failed " +
						JSON.stringify({
							approvalId: approval.request.approvalId,
							requestedProjectId: parsedInput?.projectId,
							error: queryError,
						}),
				);
				if (!cancelled) setLoadError(t("batchTasksApproval.projectLoadFailed"));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [approval, cachedProject, needsProject, parsedInput?.projectId, t]);

	useEffect(() => {
		setFormData(initialFormData);
	}, [initialFormData]);

	useEffect(() => {
		if (!approval || input?.operation !== "update" || !currentProject) return;
		console.info(
			`[action-approval:batch-tasks.project] merged ${JSON.stringify({
				approvalId: approval.request.approvalId,
				currentProject,
				agentPatch: parsedInput?.data,
				mergedInput: input,
			})}`,
		);
	}, [approval, currentProject, input, parsedInput?.data]);

	if (!approval) return null;

	const { request, responding, error, approve, reject } = approval;
	const isDelete = input?.operation === "delete";
	const isEditable = input?.operation === "create" || input?.operation === "update";

	const baseLabels = {
		loadingLabel: t("batchTasksApproval.projectLoading"),
		notFoundLabel: t("batchTasksApproval.notFoundInCurrentList"),
		unknownLabel: t("batchTasksApproval.unknown"),
		fullAccessWarning: t("batchTasksApproval.projectFullAccessWarning"),
		deleteWarning: t("batchTasksApproval.projectDeleteWarning"),
		newProjectNamePlaceholder: t("batchTasksApproval.newProjectNamePlaceholder"),
		projectNamePlaceholder: t("batchTasksApproval.projectNamePlaceholder"),
		sourceFoldersLabel: t("batchTasksApproval.sourceFolders"),
		folderListLabel: t("batchTasksApproval.folderList"),
		targetProjectLabel: t("batchTasksApproval.targetProject"),
		projectPathFieldLabel: t("batchTasksApproval.projectPath"),
		existingTasksLabel: t("batchTasksApproval.existingTasks"),
		includedTasksLabel: t("batchTasksApproval.includedTasks"),
	};

	if (loading) {
		return {
			approvalId: request.approvalId,
			phase: "loading",
			frame: null,
			loadError,
			operation: parsedInput?.operation ?? null,
			formData,
			onFormChange: setFormData,
			currentProjectName: currentProject?.name ?? "",
			projectPathLabel: input?.projectId ?? "",
			taskCountLabel: "",
			rawInput: request.input,
			...baseLabels,
		};
	}

	if (parsedInput?.operation === "update" && !currentProject) {
		return {
			approvalId: request.approvalId,
			phase: "not_found",
			frame: {
				presentation: "drawer",
				title: t("batchTasksApproval.projectUpdateTitle"),
				summary: request.summary,
				icon: "icon-[mdi--folder-cog-outline]",
				labels: {
					reject: t("actionApproval.reject"),
					confirm: t("batchTasksApproval.confirmAction", {
						action: t("batchTasksApproval.fallbackAction"),
					}),
					responding: t("actionApproval.processing"),
					permission: t("actionApproval.permission", { permission: request.permission }),
				},
				responding,
				countdown: approval.countdown.formatted,
				canApprove: false,
				onReject: reject,
				onApprove: () => approve(),
			},
			loadError,
			operation: "update",
			formData,
			onFormChange: setFormData,
			currentProjectName: "",
			projectPathLabel: parsedInput.projectId ?? "",
			taskCountLabel: "",
			rawInput: request.input,
			...baseLabels,
		};
	}

	const approveInput = (): void => {
		if (!input || !isEditable) {
			approve();
			return;
		}
		const approvedInput = buildApprovedInput(input, formData, currentProject);
		console.info(
			`[action-approval:batch-tasks.project] submit ${JSON.stringify({
				approvalId: request.approvalId,
				input: approvedInput,
			})}`,
		);
		approve(approvedInput);
	};

	const canApprove = !responding && (!isEditable || hasCreateRequiredData(formData));
	const operationLabel = input ? getProjectOperationLabel(input.operation, t) : null;
	const display = input ? getProjectOperationDisplay(input.operation, t) : null;

	return {
		approvalId: request.approvalId,
		phase: "ready",
		frame: {
			presentation: isEditable ? "drawer" : "dialog",
			title: display?.title ?? t("batchTasksApproval.projectFallbackTitle"),
			summary: display?.summary ?? request.summary,
			icon: isDelete ? "icon-[mdi--folder-remove-outline]" : "icon-[mdi--folder-cog-outline]",
			badge: operationLabel ?? undefined,
			destructive: isDelete,
			labels: {
				reject: t("actionApproval.reject"),
				confirm: t("batchTasksApproval.confirmAction", {
					action: operationLabel ?? t("batchTasksApproval.fallbackAction"),
				}),
				responding: t("actionApproval.processing"),
				permission: t("actionApproval.permission", { permission: request.permission }),
			},
			responding,
			countdown: approval.countdown.formatted,
			canApprove,
			error,
			onReject: reject,
			onApprove: approveInput,
		},
		loadError,
		operation: input?.operation ?? null,
		formData,
		onFormChange: setFormData,
		currentProjectName: currentProject?.name ?? baseLabels.notFoundLabel,
		projectPathLabel: input?.projectId ?? baseLabels.unknownLabel,
		taskCountLabel: t("batchTasksApproval.count", {
			count: currentProject?.tasks.length ?? baseLabels.unknownLabel,
		}),
		rawInput: request.input,
		...baseLabels,
	};
}
