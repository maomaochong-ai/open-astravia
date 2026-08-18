import type { BatchProjectApprovalJsonData, BatchProjectEditableData } from "../components/BatchProjectFormFields";

export function compactLines(lines: string[]): string[] {
	return [...new Set(lines.map((line) => line.trim()).filter((line) => line.length > 0))];
}

export function toBatchProjectApprovalJsonData(data: BatchProjectEditableData): BatchProjectApprovalJsonData {
	const result: BatchProjectApprovalJsonData = {};
	if (data.name !== undefined) result.name = data.name;
	if (data.prompt !== undefined) result.prompt = data.prompt;
	if (data.modelKey !== undefined) result.modelKey = data.modelKey;
	if (data.executionMode !== undefined) result.executionMode = data.executionMode;
	if (data.concurrency !== undefined) result.concurrency = normalizeConcurrency(data.concurrency);
	if (data.artifactPatterns !== undefined) result.artifactPatterns = compactLines(data.artifactPatterns);
	if (data.notifyEnabled !== undefined) result.notifyEnabled = data.notifyEnabled;
	if (data.timeoutMinutes !== undefined) result.timeoutMinutes = normalizeTimeout(data.timeoutMinutes);
	if (data.folders !== undefined) result.folders = compactLines(data.folders);
	if (data.newFolders !== undefined) result.newFolders = compactLines(data.newFolders);
	if (data.skill !== undefined) result.skill = data.skill;
	return result;
}

export function normalizeConcurrency(value: number | undefined): number {
	return Number.isFinite(value) && value !== undefined && value > 0 ? Math.floor(value) : 1;
}

export function normalizeTimeout(value: number | undefined): number {
	return Number.isFinite(value) && value !== undefined && value > 0 ? Math.floor(value) : 60;
}
