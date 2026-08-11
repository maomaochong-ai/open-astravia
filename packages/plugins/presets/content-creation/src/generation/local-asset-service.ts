import type { PluginFsApi, PluginFsBinaryReadResult } from "@vetta-org/plugin-sdk";
import type { AssetKind } from "../project/types";
import {
	assetKindForMimeType,
	type ContentAssetImportResult,
	type ContentAssetImportService,
} from "./asset-import-service";
import type { ImportedContentAsset } from "./types";

const MAX_DISCOVERED_MEDIA = 200;
const MAX_IMPORTED_MEDIA = 50;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	mp4: "video/mp4",
	m4v: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	m4a: "audio/mp4",
};

export type ContentLocalAssetErrorCode =
	| "local-media-path-not-found"
	| "local-media-path-not-authorized"
	| "local-media-not-found"
	| "local-media-selection-required"
	| "local-media-too-many"
	| "local-media-unsupported"
	| "local-media-read-failed";

export class ContentLocalAssetError extends Error {
	constructor(
		message: string,
		readonly code: ContentLocalAssetErrorCode,
		readonly details?: Record<string, unknown>,
		readonly retryable = true,
	) {
		super(message);
	}
}

export interface ContentLocalAssetCandidate {
	path: string;
	name: string;
	size?: number;
	kind: AssetKind;
	mimeType: string;
}

export interface ContentLocalAssetImportOptions {
	projectDir: string | null;
	paths: readonly string[];
	recursive?: boolean;
	directoryMode?: "select-one" | "all";
	targetNodeId?: string;
	expectedRevision?: number;
	nodeName?: string;
	nodePurpose?: string;
}

interface CandidateResolution {
	candidates: ContentLocalAssetCandidate[];
	includedDirectory: boolean;
	previewBinaries: Map<string, PluginFsBinaryReadResult>;
}

/** Resolves host-authorized local paths without exposing media bytes to the Agent. */
export class ContentLocalAssetService {
	constructor(
		private readonly fs: PluginFsApi,
		private readonly imports: ContentAssetImportService,
	) {}

	async list(paths: readonly string[], recursive = false): Promise<ContentLocalAssetCandidate[]> {
		return (await this.resolveCandidates(paths, recursive)).candidates;
	}

	async import(options: ContentLocalAssetImportOptions): Promise<ContentAssetImportResult> {
		const resolved = await this.resolveCandidates(options.paths, options.recursive ?? false);
		if (
			resolved.includedDirectory &&
			resolved.candidates.length > 1 &&
			(options.directoryMode ?? "select-one") === "select-one"
		) {
			throw new ContentLocalAssetError(
				"directory contains multiple media files; select explicit paths or set directoryMode to all",
				"local-media-selection-required",
				{ candidates: resolved.candidates },
			);
		}
		if (resolved.candidates.length > MAX_IMPORTED_MEDIA) {
			throw new ContentLocalAssetError(
				`cannot import more than ${MAX_IMPORTED_MEDIA} media files at once`,
				"local-media-too-many",
				{ count: resolved.candidates.length, maximum: MAX_IMPORTED_MEDIA },
			);
		}

		const files: ImportedContentAsset[] = [];
		for (const candidate of resolved.candidates) {
			const binary = resolved.previewBinaries.get(candidate.path) ?? await this.readBinary(candidate.path);
			const mimeType = normalizeDetectedMimeType(binary.mimeType, candidate.mimeType);
			if (!assetKindForMimeType(mimeType)) {
				throw new ContentLocalAssetError(
					`unsupported local media type: ${mimeType}`,
					"local-media-unsupported",
					{ path: candidate.path, mimeType },
					false,
				);
			}
			files.push({ name: candidate.name, mimeType, data: binary.data });
		}

		return await this.imports.import(options.projectDir, files, {
			targetNodeId: options.targetNodeId,
			expectedRevision: options.expectedRevision,
			nodeName: options.nodeName,
			nodePurpose: options.nodePurpose,
		});
	}

	private async resolveCandidates(paths: readonly string[], recursive: boolean): Promise<CandidateResolution> {
		const requestedPaths = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
		if (requestedPaths.length === 0) {
			throw new ContentLocalAssetError("at least one local media path is required", "local-media-not-found");
		}
		const candidates: ContentLocalAssetCandidate[] = [];
		const previewBinaries = new Map<string, PluginFsBinaryReadResult>();
		let includedDirectory = false;
		for (const path of requestedPaths) {
			let stat;
			try {
				stat = await this.fs.stat(path);
			} catch (error) {
				if (!isAuthorizationError(error)) throw mapFsError(path, error);
				const preview = await this.readBinary(path).catch(() => null);
				if (!preview) throw mapFsError(path, error);
				const inferredMimeType = MIME_BY_EXTENSION[fileExtension(path)] ?? preview.mimeType;
				const mimeType = normalizeDetectedMimeType(preview.mimeType, inferredMimeType);
				const kind = assetKindForMimeType(mimeType);
				if (!kind) {
					throw new ContentLocalAssetError(
						`unsupported local media type: ${mimeType}`,
						"local-media-unsupported",
						{ path, mimeType },
						false,
					);
				}
				candidates.push({ path, name: baseName(path), size: preview.size, kind, mimeType });
				previewBinaries.set(path, preview);
				continue;
			}
			if (!stat) {
				throw new ContentLocalAssetError(
					`local media path not found: ${path}`,
					"local-media-path-not-found",
					{ path },
					false,
				);
			}
			const entries = await this.tryReadDirectory(path);
			if (entries) {
				includedDirectory = true;
				const files = recursive
					? await this.listFilesRecursive(path)
					: entries.filter((entry) => !entry.isDirectory).map((entry) => ({
							name: entry.name,
							path: entry.path,
							size: entry.size,
						}));
				for (const file of files) addCandidate(candidates, file.path, file.name, "size" in file ? file.size : undefined);
			} else {
				addCandidate(candidates, path, baseName(path), stat.size);
			}
			if (candidates.length > MAX_DISCOVERED_MEDIA) {
				throw new ContentLocalAssetError(
					`media discovery exceeded ${MAX_DISCOVERED_MEDIA} files`,
					"local-media-too-many",
					{ maximum: MAX_DISCOVERED_MEDIA },
				);
			}
		}
		const unique = candidates.filter(
			(candidate, index) => candidates.findIndex((current) => current.path === candidate.path) === index,
		);
		if (unique.length === 0) {
			throw new ContentLocalAssetError(
				"no supported image, video, or audio files were found",
				"local-media-not-found",
				{ paths: requestedPaths },
			);
		}
		return { candidates: unique, includedDirectory, previewBinaries };
	}

	private async tryReadDirectory(path: string) {
		try {
			return await this.fs.readDir(path);
		} catch (error) {
			if (isAuthorizationError(error)) throw mapFsError(path, error);
			return null;
		}
	}

	private async listFilesRecursive(path: string) {
		try {
			return await this.fs.listFilesRecursive(path);
		} catch (error) {
			throw mapFsError(path, error);
		}
	}

	private async readBinary(path: string) {
		try {
			return await this.fs.readBinaryFile(path);
		} catch (error) {
			throw mapFsError(path, error);
		}
	}
}

function addCandidate(
	target: ContentLocalAssetCandidate[],
	path: string,
	name: string,
	size: number | undefined,
): void {
	const mimeType = MIME_BY_EXTENSION[fileExtension(name)];
	const kind = mimeType ? assetKindForMimeType(mimeType) : null;
	if (mimeType && kind) target.push({ path, name, ...(size === undefined ? {} : { size }), kind, mimeType });
}

function normalizeDetectedMimeType(detected: string, inferred: string): string {
	return detected === "application/octet-stream" ? inferred : detected;
}

function baseName(path: string): string {
	return path.replace(/[/\\]+$/, "").split(/[/\\]/).at(-1) ?? path;
}

function fileExtension(name: string): string {
	const index = name.lastIndexOf(".");
	return index < 0 ? "" : name.slice(index + 1).toLowerCase();
}

function isAuthorizationError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /outside any (known project|previewable) directory/i.test(message);
}

function mapFsError(path: string, error: unknown): ContentLocalAssetError {
	const message = error instanceof Error ? error.message : String(error);
	if (isAuthorizationError(error)) {
		return new ContentLocalAssetError(
			"local media path is outside the host-authorized workspace roots; select the directory as a workspace or provide explicit media file paths",
			"local-media-path-not-authorized",
			{
				path,
				recovery: [
					"select the directory as the active workspace or project root",
					"provide explicit image, video, or audio file paths",
				],
			},
			false,
		);
	}
	return new ContentLocalAssetError(
		`failed to read local media: ${message}`,
		"local-media-read-failed",
		{ path },
	);
}
