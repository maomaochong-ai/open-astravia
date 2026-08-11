import type { ImportedContentAsset } from "../generation/types";
import { createImportedMediaFile, isImportedMediaFile } from "./imported-media-file";

const DROP_IMPORT_BATCH_SIZE = 4;

export interface DroppedMediaFile {
	file: File;
	name: string;
}

export function dataTransferHasFiles(dataTransfer: DataTransfer): boolean {
	return dataTransfer.types.includes("Files");
}

export async function collectDroppedMediaFiles(dataTransfer: DataTransfer): Promise<DroppedMediaFile[]> {
	const items = Array.from(dataTransfer.items).filter((item) => item.kind === "file");
	const directFiles = Array.from(dataTransfer.files);
	const itemSources = items.map((item) => ({ entry: item.webkitGetAsEntry(), file: item.getAsFile() }));
	const droppedFiles: DroppedMediaFile[] = [];
	const resolvedEntry = itemSources.some(({ entry }) => Boolean(entry));

	for (const { entry, file } of itemSources) {
		if (entry) {
			droppedFiles.push(...(await collectEntryFiles(entry)));
			continue;
		}
		if (file) droppedFiles.push(toDroppedMediaFile(file));
	}

	if (!resolvedEntry && droppedFiles.length === 0) {
		droppedFiles.push(...directFiles.map(toDroppedMediaFile));
	}

	const uniqueFiles = new Map<string, DroppedMediaFile>();
	for (const droppedFile of droppedFiles) {
		if (!isImportedMediaFile(droppedFile.file)) continue;
		const key = `${droppedFile.name}\u0000${droppedFile.file.size}\u0000${droppedFile.file.lastModified}`;
		if (!uniqueFiles.has(key)) uniqueFiles.set(key, droppedFile);
	}
	return [...uniqueFiles.values()];
}

export async function importDroppedMediaFiles(
	files: readonly DroppedMediaFile[],
	onImport: (files: readonly ImportedContentAsset[]) => Promise<void>,
): Promise<void> {
	for (let index = 0; index < files.length; index += DROP_IMPORT_BATCH_SIZE) {
		const batch = files.slice(index, index + DROP_IMPORT_BATCH_SIZE);
		const importedFiles = await Promise.all(batch.map(({ file, name }) => createImportedMediaFile(file, name)));
		await onImport(importedFiles);
	}
}

async function collectEntryFiles(entry: FileSystemEntry): Promise<DroppedMediaFile[]> {
	if (entry.isFile) {
		const file = await readEntryFile(entry as FileSystemFileEntry);
		return file ? [{ file, name: relativeEntryPath(entry) || file.name }] : [];
	}
	if (!entry.isDirectory) return [];

	const entries = await readDirectoryEntries((entry as FileSystemDirectoryEntry).createReader());
	const files: DroppedMediaFile[] = [];
	for (const childEntry of entries) files.push(...(await collectEntryFiles(childEntry)));
	return files;
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File | null> {
	return new Promise((resolve) => entry.file(resolve, () => resolve(null)));
}

async function readDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
	const entries: FileSystemEntry[] = [];
	while (true) {
		const batch = await new Promise<FileSystemEntry[]>((resolve) =>
			reader.readEntries(resolve, () => resolve([])),
		);
		if (batch.length === 0) return entries;
		entries.push(...batch);
	}
}

function toDroppedMediaFile(file: File): DroppedMediaFile {
	return { file, name: file.webkitRelativePath || file.name };
}

function relativeEntryPath(entry: FileSystemEntry): string {
	return entry.fullPath.replace(/^\/+/, "");
}
