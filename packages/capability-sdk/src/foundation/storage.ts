import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema } from "../schema.js";
import { CAPABILITY_JSON_MAP_TYPE, CAPABILITY_JSON_VALUE_TYPE, type CapabilityJsonMap } from "./json.js";

const storageNamespaceType = Type.String({
	pattern: "^(?!.*\\.\\.)[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$",
});
const storageStrictKeyType = Type.String({ pattern: "^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$" });
const requiredInputStringType = Type.String({ pattern: "\\S" });
const storageGetAllInputType = Type.Object({ namespace: storageNamespaceType });
const storageSetInputType = Type.Object({
	namespace: storageNamespaceType,
	key: storageStrictKeyType,
	value: CAPABILITY_JSON_VALUE_TYPE,
});
const storageRemoveInputType = Type.Object({
	namespace: storageNamespaceType,
	key: storageStrictKeyType,
});
const storageListInputType = Type.Object({
	namespace: storageNamespaceType,
	prefix: Type.Optional(Type.String({ minLength: 1 })),
});
const storageFileReadInputType = Type.Object({
	namespace: storageNamespaceType,
	path: requiredInputStringType,
	encoding: Type.Union([Type.Literal("utf8"), Type.Literal("base64")]),
});
const storageDataType = Type.String();
const storageSnapshotReadInputType = Type.Object({
	namespace: storageNamespaceType,
	paths: Type.Array(requiredInputStringType, { minItems: 1, maxItems: 128 }),
	encoding: Type.Union([Type.Literal("utf8"), Type.Literal("base64")]),
});
const storageCommitEntryType = Type.Object({
	type: Type.Literal("write"),
	path: requiredInputStringType,
	data: storageDataType,
	encoding: Type.Union([Type.Literal("utf8"), Type.Literal("base64")]),
});
const storageCommitRemoveType = Type.Object({ type: Type.Literal("remove"), path: requiredInputStringType });
const storageCommitInputType = Type.Object({
	namespace: storageNamespaceType,
	changes: Type.Array(Type.Union([storageCommitEntryType, storageCommitRemoveType]), { minItems: 1, maxItems: 128 }),
	expectedRevision: Type.Optional(Type.String({ minLength: 1 })),
});
const storageBlobWriteType = Type.Object({
	id: Type.Optional(Type.String({ minLength: 1 })),
	data: requiredInputStringType,
	mimeType: requiredInputStringType,
});
const storageBlobFileWriteType = Type.Object({
	id: Type.Optional(Type.String({ minLength: 1 })),
	path: requiredInputStringType,
	mimeType: requiredInputStringType,
});
const storageBlobPutInputType = Type.Object({
	namespace: storageNamespaceType,
	blob: storageBlobWriteType,
});
const storageBlobFilePutInputType = Type.Object({
	namespace: storageNamespaceType,
	blob: storageBlobFileWriteType,
});
const storageBlobReadInputType = Type.Object({
	namespace: storageNamespaceType,
	id: requiredInputStringType,
});
const storageBlobRefType = Type.Object({
	id: Type.String(),
	url: Type.String(),
	mimeType: Type.String(),
});
const storageBlobType = Type.Object({
	data: Type.String(),
	mimeType: Type.String(),
});

export type StorageGetAllInput = Readonly<Static<typeof storageGetAllInputType>>;
export type StorageSetInput = Readonly<Static<typeof storageSetInputType>>;
export type StorageRemoveInput = Readonly<Static<typeof storageRemoveInputType>>;
export type StorageListInput = Readonly<Static<typeof storageListInputType>>;
export type StorageFileReadInput = Readonly<Static<typeof storageFileReadInputType>>;
export type StorageSnapshotReadInput = Readonly<Static<typeof storageSnapshotReadInputType>>;
export type StorageCommitEntry = Readonly<Static<typeof storageCommitEntryType>>;
export type StorageCommitInput = Readonly<Static<typeof storageCommitInputType>>;
export type StorageBlobWrite = Readonly<Static<typeof storageBlobWriteType>>;
export type StorageBlobFileWrite = Readonly<Static<typeof storageBlobFileWriteType>>;
export type StorageBlobPutInput = Readonly<Static<typeof storageBlobPutInputType>>;
export type StorageBlobFilePutInput = Readonly<Static<typeof storageBlobFilePutInputType>>;
export type StorageBlobReadInput = Readonly<Static<typeof storageBlobReadInputType>>;
export type StorageBlobRef = Readonly<Static<typeof storageBlobRefType>>;
export type StorageBlob = Readonly<Static<typeof storageBlobType>>;

const storageGetAllInputSchema = defineCapabilityInputSchema(storageGetAllInputType, { clean: true });
const storageSetInputSchema = defineCapabilityInputSchema(storageSetInputType, { clean: true });
const storageRemoveInputSchema = defineCapabilityInputSchema(storageRemoveInputType, { clean: true });
const storageListInputSchema = defineCapabilityInputSchema(storageListInputType, { clean: true });
const storageFileReadInputSchema = defineCapabilityInputSchema(storageFileReadInputType, { clean: true });
const storageBlobPutInputSchema = defineCapabilityInputSchema(storageBlobPutInputType, { clean: true });
const storageBlobFilePutInputSchema = defineCapabilityInputSchema(storageBlobFilePutInputType, { clean: true });
const storageBlobReadInputSchema = defineCapabilityInputSchema(storageBlobReadInputType, { clean: true });
const storageJsonMapOutputSchema = defineCapabilityOutputSchema(CAPABILITY_JSON_MAP_TYPE);
const storageStringListOutputSchema = defineCapabilityOutputSchema(Type.Array(Type.String()));
const storageNullableStringOutputSchema = defineCapabilityOutputSchema(Type.Union([Type.Null(), Type.String()]));
const storageSnapshotOutputSchema = defineCapabilityOutputSchema(
	Type.Object({
		revision: Type.String(),
		files: Type.Record(Type.String(), Type.Union([Type.Null(), Type.String()])),
	}),
);
const storageCommitOutputSchema = defineCapabilityOutputSchema(
	Type.Object({ revision: Type.String(), changedPaths: Type.Array(Type.String()) }),
);
const storageBlobRefOutputSchema = defineCapabilityOutputSchema(storageBlobRefType, { clean: true });
const storageNullableBlobOutputSchema = defineCapabilityOutputSchema(Type.Union([Type.Null(), storageBlobType]), {
	clean: true,
});
const storageNullableBlobRefOutputSchema = defineCapabilityOutputSchema(Type.Union([Type.Null(), storageBlobRefType]), {
	clean: true,
});

export const FOUNDATION_STORAGE_CAPABILITIES = {
	GET_ALL: defineCapability<StorageGetAllInput, CapabilityJsonMap>({
		id: "cap.foundation.vetta.storage.get-all",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: storageGetAllInputSchema,
		output: storageJsonMapOutputSchema,
	}),
	SET: defineCapability<StorageSetInput, CapabilityJsonMap>({
		id: "cap.foundation.vetta.storage.set",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: storageSetInputSchema,
		output: storageJsonMapOutputSchema,
	}),
	REMOVE: defineCapability<StorageRemoveInput, CapabilityJsonMap>({
		id: "cap.foundation.vetta.storage.remove",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: storageRemoveInputSchema,
		output: storageJsonMapOutputSchema,
	}),
	CLEAR: defineCapability<StorageGetAllInput, CapabilityJsonMap>({
		id: "cap.foundation.vetta.storage.clear",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: storageGetAllInputSchema,
		output: storageJsonMapOutputSchema,
	}),
	LIST: defineCapability<StorageListInput, string[]>({
		id: "cap.foundation.vetta.storage.list",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: storageListInputSchema,
		output: storageStringListOutputSchema,
	}),
	READ_FILE: defineCapability<StorageFileReadInput, string | null>({
		id: "cap.foundation.vetta.storage.read-file",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: storageFileReadInputSchema,
		output: storageNullableStringOutputSchema,
	}),
	READ_SNAPSHOT: defineCapability<
		Readonly<Static<typeof storageSnapshotReadInputType>>,
		{ revision: string; files: Record<string, string | null> }
	>({
		id: "cap.foundation.vetta.storage.read-snapshot",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: defineCapabilityInputSchema(storageSnapshotReadInputType, { clean: true }),
		output: storageSnapshotOutputSchema,
	}),
	COMMIT: defineCapability<
		Readonly<Static<typeof storageCommitInputType>>,
		{
			revision: string;
			changedPaths: string[];
		}
	>({
		id: "cap.foundation.vetta.storage.commit",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: defineCapabilityInputSchema(storageCommitInputType, { clean: true }),
		output: storageCommitOutputSchema,
	}),
	PUT_BLOB: defineCapability<StorageBlobPutInput, StorageBlobRef>({
		id: "cap.foundation.vetta.storage.put-blob",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: storageBlobPutInputSchema,
		output: storageBlobRefOutputSchema,
	}),
	PUT_BLOB_FROM_FILE: defineCapability<StorageBlobFilePutInput, StorageBlobRef>({
		id: "cap.foundation.vetta.storage.put-blob-from-file",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: storageBlobFilePutInputSchema,
		output: storageBlobRefOutputSchema,
	}),
	READ_BLOB: defineCapability<StorageBlobReadInput, StorageBlob | null>({
		id: "cap.foundation.vetta.storage.read-blob",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: storageBlobReadInputSchema,
		output: storageNullableBlobOutputSchema,
	}),
	GET_BLOB_REF: defineCapability<StorageBlobReadInput, StorageBlobRef | null>({
		id: "cap.foundation.vetta.storage.get-blob-ref",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: storageBlobReadInputSchema,
		output: storageNullableBlobRefOutputSchema,
	}),
} as const;

export const FOUNDATION_STORAGE_CAPABILITY_CATALOG = createCapabilityCatalog(
	Object.values(FOUNDATION_STORAGE_CAPABILITIES),
);
