import type {
	PluginImageRef,
	PluginStorageApi,
	PluginStoredBlobRef,
} from "@vetta-org/plugin-sdk";

interface ImageRecord {
	id: string;
	rootId: string;
	parent?: string;
	sessionId?: string;
	createdAt: string;
	mimeType: string;
}

interface LegacyImageRecord {
	rootId: string;
	parent?: string;
	sessionId?: string;
	createdAt: string;
	ext: string;
	mimeType: string;
}

type LegacyImageIndex = Record<string, LegacyImageRecord>;

export interface PersistImageMetadata {
	rootId?: string;
	parent?: string;
	sessionId?: string;
}

export interface ImageRepository {
	persist(blob: PluginStoredBlobRef, metadata: PersistImageMetadata): Promise<PluginImageRef>;
	read(id: string): Promise<PluginStoredBlobRef | null>;
	lineage(imageId: string): Promise<PluginImageRef[]>;
	sessionLineages(sessionId: string): Promise<PluginImageRef[][]>;
}

function recordKey(id: string): string {
	return `records/${id}.json`;
}

async function toRef(
	storage: PluginStorageApi,
	record: ImageRecord,
): Promise<PluginImageRef | null> {
	const blob = await storage.getBlobRef(record.id);
	if (!blob) return null;
	return {
		id: record.id,
		url: blob.url,
		mimeType: record.mimeType,
		rootId: record.rootId,
	};
}

export function createImageRepository(storage: PluginStorageApi): ImageRepository {
	let migration: Promise<void> | null = null;

	const migrateLegacyIndex = async (): Promise<void> => {
		const migrated = await storage.readJson<boolean>("migration/image-service-v1.json");
		if (migrated) return;
		let legacy: LegacyImageIndex | null = null;
		try {
			legacy = await storage.readJson<LegacyImageIndex>("index.json");
		} catch {
			// The legacy service tolerated a partially written/corrupt index.
			// Preserve that behavior so new image generation remains available.
		}
		for (const [id, record] of Object.entries(legacy ?? {})) {
			const existing = await storage.readJson<ImageRecord>(recordKey(id));
			if (existing) continue;
			const data = await storage.readFile(`images/${id}.${record.ext}`);
			if (!data) continue;
			await storage.putBlob({ id, data, mimeType: record.mimeType });
			await storage.writeJson(recordKey(id), {
				id,
				rootId: record.rootId,
				parent: record.parent,
				sessionId: record.sessionId,
				createdAt: record.createdAt,
				mimeType: record.mimeType,
			} satisfies ImageRecord);
		}
		await storage.writeJson("migration/image-service-v1.json", true);
	};

	const ensureMigrated = (): Promise<void> => {
		migration ??= migrateLegacyIndex();
		return migration;
	};

	const readRecords = async (): Promise<ImageRecord[]> => {
		await ensureMigrated();
		const keys = (await storage.list("records")).filter((key) => key.endsWith(".json"));
		const records = await Promise.all(keys.map((key) => storage.readJson<ImageRecord>(key)));
		return records.filter((record): record is ImageRecord => record !== null);
	};

	return {
		async persist(blob, metadata) {
			await ensureMigrated();
			const record: ImageRecord = {
				id: blob.id,
				rootId: metadata.rootId ?? blob.id,
				parent: metadata.parent,
				sessionId: metadata.sessionId,
				createdAt: new Date().toISOString(),
				mimeType: blob.mimeType,
			};
			await storage.writeJson(recordKey(record.id), record);
			return {
				id: record.id,
				url: blob.url,
				mimeType: record.mimeType,
				rootId: record.rootId,
			};
		},
		async read(id) {
			await ensureMigrated();
			return storage.getBlobRef(id);
		},
		async lineage(imageId) {
			const records = await readRecords();
			const source = records.find((record) => record.id === imageId);
			if (!source) return [];
			const refs = await Promise.all(
				records
					.filter((record) => record.rootId === source.rootId)
					.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
					.map((record) => toRef(storage, record)),
			);
			return refs.filter((ref): ref is PluginImageRef => ref !== null);
		},
		async sessionLineages(sessionId) {
			const records = await readRecords();
			const roots = new Set(
				records
					.filter((record) => record.sessionId === sessionId)
					.map((record) => record.rootId),
			);
			const lineages = await Promise.all(
				Array.from(roots).map(async (rootId) => {
					const members = records
						.filter((record) => record.rootId === rootId)
						.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
					const refs = await Promise.all(
						members.map((record) => toRef(storage, record)),
					);
					return {
						latest: members.at(-1)?.createdAt ?? "",
						refs: refs.filter((ref): ref is PluginImageRef => ref !== null),
					};
				}),
			);
			return lineages
				.sort((left, right) => right.latest.localeCompare(left.latest))
				.map((lineage) => lineage.refs);
		},
	};
}
