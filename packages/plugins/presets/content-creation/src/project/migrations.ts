import {
	CONTENT_CREATION_SCHEMA_VERSION,
	type AssetKind,
	type ContentAsset,
	type ContentProjectDocument,
} from "./types";

interface LegacyContentAsset {
	id: string;
	kind: AssetKind;
	name: string;
	mimeType: string;
	url?: string;
	duration?: number;
	width?: number;
	height?: number;
	createdAt: string;
}

interface ProjectShell {
	schemaVersion?: unknown;
	cwd?: unknown;
	revision?: unknown;
	graph?: { nodes?: unknown; edges?: unknown };
	assets?: unknown;
	timeline?: { tracks?: unknown };
}

export function migrateContentProjectDocument(value: unknown, cwd: string | null): ContentProjectDocument | null {
	if (!isProjectShell(value, cwd)) return null;
	if (value.schemaVersion === CONTENT_CREATION_SCHEMA_VERSION) {
		return value.assets.every(isCurrentContentAsset) ? (value as ContentProjectDocument) : null;
	}
	if (value.schemaVersion !== 1 || !value.assets.every(isLegacyContentAsset)) return null;

	return {
		...(value as unknown as Omit<ContentProjectDocument, "schemaVersion" | "assets">),
		schemaVersion: CONTENT_CREATION_SCHEMA_VERSION,
		assets: value.assets.map(migrateLegacyContentAsset),
	};
}

function isProjectShell(value: unknown, cwd: string | null): value is ProjectShell & { assets: unknown[] } {
	if (!value || typeof value !== "object") return false;
	const candidate = value as ProjectShell;
	return (
		candidate.cwd === cwd &&
		typeof candidate.revision === "number" &&
		Array.isArray(candidate.graph?.nodes) &&
		Array.isArray(candidate.graph?.edges) &&
		Array.isArray(candidate.assets) &&
		Array.isArray(candidate.timeline?.tracks)
	);
}

function isCurrentContentAsset(value: unknown): value is ContentAsset {
	return isLegacyContentAsset(value) && typeof (value as { blobId?: unknown }).blobId === "string";
}

function isLegacyContentAsset(value: unknown): value is LegacyContentAsset {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<LegacyContentAsset>;
	return (
		typeof candidate.id === "string" &&
		(candidate.kind === "image" || candidate.kind === "video" || candidate.kind === "audio") &&
		typeof candidate.name === "string" &&
		typeof candidate.mimeType === "string" &&
		typeof candidate.createdAt === "string"
	);
}

function migrateLegacyContentAsset(asset: LegacyContentAsset): ContentAsset {
	return {
		id: asset.id,
		blobId: asset.id,
		kind: asset.kind,
		name: asset.name,
		mimeType: asset.mimeType,
		duration: asset.duration,
		width: asset.width,
		height: asset.height,
		createdAt: asset.createdAt,
	};
}
