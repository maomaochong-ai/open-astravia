import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import {
	defineCapabilityInputSchema,
	defineCapabilityNoOutputSchema,
	defineCapabilityOutputSchema,
} from "../schema.js";
import {
	CAPABILITY_JSON_MAP_TYPE,
	CAPABILITY_JSON_VALUE_TYPE,
	type CapabilityJsonMap,
	type CapabilityJsonValue,
} from "./json.js";

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
const storageJsonReadInputType = Type.Object({
	namespace: storageNamespaceType,
	key: requiredInputStringType,
});
const storageJsonWriteInputType = Type.Object({
	namespace: storageNamespaceType,
	key: requiredInputStringType,
	value: CAPABILITY_JSON_VALUE_TYPE,
});
const storageListInputType = Type.Object({
	namespace: storageNamespaceType,
	prefix: Type.Optional(Type.String({ minLength: 1 })),
});
const storageFileReadInputType = Type.Object({
	namespace: storageNamespaceType,
	path: requiredInputStringType,
});
const storageFileWriteInputType = Type.Object({
	namespace: storageNamespaceType,
	path: requiredInputStringType,
	data: requiredInputStringType,
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
export type StorageJsonReadInput = Readonly<Static<typeof storageJsonReadInputType>>;
export type StorageJsonWriteInput = Readonly<Static<typeof storageJsonWriteInputType>>;
export type StorageListInput = Readonly<Static<typeof storageListInputType>>;
export type StorageFileReadInput = Readonly<Static<typeof storageFileReadInputType>>;
export type StorageFileWriteInput = Readonly<Static<typeof storageFileWriteInputType>>;
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
const storageJsonReadInputSchema = defineCapabilityInputSchema(storageJsonReadInputType, { clean: true });
const storageJsonWriteInputSchema = defineCapabilityInputSchema(storageJsonWriteInputType, { clean: true });
const storageListInputSchema = defineCapabilityInputSchema(storageListInputType, { clean: true });
const storageFileReadInputSchema = defineCapabilityInputSchema(storageFileReadInputType, { clean: true });
const storageFileWriteInputSchema = defineCapabilityInputSchema(storageFileWriteInputType, { clean: true });
const storageBlobPutInputSchema = defineCapabilityInputSchema(storageBlobPutInputType, { clean: true });
const storageBlobFilePutInputSchema = defineCapabilityInputSchema(storageBlobFilePutInputType, { clean: true });
const storageBlobReadInputSchema = defineCapabilityInputSchema(storageBlobReadInputType, { clean: true });
const storageJsonMapOutputSchema = defineCapabilityOutputSchema(CAPABILITY_JSON_MAP_TYPE);
const storageJsonValueOutputSchema = defineCapabilityOutputSchema(CAPABILITY_JSON_VALUE_TYPE);
const storageStringListOutputSchema = defineCapabilityOutputSchema(Type.Array(Type.String()));
const storageNullableStringOutputSchema = defineCapabilityOutputSchema(Type.Union([Type.Null(), Type.String()]));
const storageBlobRefOutputSchema = defineCapabilityOutputSchema(storageBlobRefType, { clean: true });
const storageNullableBlobOutputSchema = defineCapabilityOutputSchema(Type.Union([Type.Null(), storageBlobType]), {
	clean: true,
});
const storageNullableBlobRefOutputSchema = defineCapabilityOutputSchema(Type.Union([Type.Null(), storageBlobRefType]), {
	clean: true,
});
const storageNoOutputSchema = defineCapabilityNoOutputSchema();

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
	READ_JSON: defineCapability<StorageJsonReadInput, CapabilityJsonValue>({
		id: "cap.foundation.vetta.storage.read-json",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: storageJsonReadInputSchema,
		output: storageJsonValueOutputSchema,
	}),
	WRITE_JSON: defineCapability<StorageJsonWriteInput, undefined>({
		id: "cap.foundation.vetta.storage.write-json",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: storageJsonWriteInputSchema,
		output: storageNoOutputSchema,
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
	WRITE_FILE: defineCapability<StorageFileWriteInput, undefined>({
		id: "cap.foundation.vetta.storage.write-file",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: storageFileWriteInputSchema,
		output: storageNoOutputSchema,
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
