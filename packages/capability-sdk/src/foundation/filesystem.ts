import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import {
	defineCapabilityInputSchema,
	defineCapabilityNoOutputSchema,
	defineCapabilityOutputSchema,
} from "../schema.js";

const requiredInputStringType = Type.String({ pattern: "\\S" });
const filesystemPathInputType = Type.Object({ path: requiredInputStringType });
/** 单个文件或目录名：不含路径分隔符，也不是 `.` / `..`。 */
const filesystemBaseNameType = Type.String({ pattern: "^(?!\\.{1,2}$)[^/\\\\]+$", maxLength: 255 });
const filesystemListRecursiveInputType = Type.Object({
	path: requiredInputStringType,
	/** 只返回这些文件名（精确匹配）；上限按命中数计。 */
	names: Type.Optional(Type.Array(filesystemBaseNameType, { maxItems: 64 })),
	/** 在宿主默认忽略目录之外再跳过的目录名。 */
	ignoredDirectories: Type.Optional(Type.Array(filesystemBaseNameType, { maxItems: 64 })),
});
const filesystemRenameInputType = Type.Object({
	oldPath: requiredInputStringType,
	newPath: requiredInputStringType,
});
const filesystemMoveInputType = Type.Object({
	sourcePath: requiredInputStringType,
	destinationDirectory: requiredInputStringType,
});
const filesystemEncodingType = Type.Union([Type.Literal("utf8"), Type.Literal("base64")]);
const filesystemWriteFileInputType = Type.Object({
	path: requiredInputStringType,
	content: Type.String(),
	encoding: Type.Optional(filesystemEncodingType),
});
const filesystemEntryType = Type.Object({
	name: Type.String(),
	path: Type.String(),
	isDirectory: Type.Boolean(),
	size: Type.Number(),
	modifiedAt: Type.Number(),
});
const filesystemFileRefType = Type.Object({
	name: Type.String(),
	path: Type.String(),
	relPath: Type.String(),
});
const filesystemReadFileResultType = Type.Object({
	content: Type.String(),
	encoding: filesystemEncodingType,
});
const filesystemReadBinaryFileResultType = Type.Object({
	data: Type.String(),
	mimeType: Type.String(),
	size: Type.Number(),
});
const filesystemStatResultType = Type.Object({
	size: Type.Number(),
	modifiedAt: Type.Number(),
	createdAt: Type.Number(),
});

export type FilesystemPathInput = Readonly<Static<typeof filesystemPathInputType>>;
export type FilesystemListRecursiveInput = Readonly<Static<typeof filesystemListRecursiveInputType>>;
export type FilesystemRenameInput = Readonly<Static<typeof filesystemRenameInputType>>;
export type FilesystemMoveInput = Readonly<Static<typeof filesystemMoveInputType>>;
export type FilesystemWriteFileInput = Readonly<Static<typeof filesystemWriteFileInputType>>;
export type FilesystemEntry = Readonly<Static<typeof filesystemEntryType>>;
export type FilesystemFileRef = Readonly<Static<typeof filesystemFileRefType>>;
export type FilesystemReadFileResult = Readonly<Static<typeof filesystemReadFileResultType>>;
export type FilesystemReadBinaryFileResult = Readonly<Static<typeof filesystemReadBinaryFileResultType>>;
export type FilesystemStatResult = Readonly<Static<typeof filesystemStatResultType>>;

const filesystemPathInputSchema = defineCapabilityInputSchema(filesystemPathInputType, { clean: true });
const filesystemListRecursiveInputSchema = defineCapabilityInputSchema(filesystemListRecursiveInputType, {
	clean: true,
});
const filesystemRenameInputSchema = defineCapabilityInputSchema(filesystemRenameInputType, { clean: true });
const filesystemMoveInputSchema = defineCapabilityInputSchema(filesystemMoveInputType, { clean: true });
const filesystemWriteFileInputSchema = defineCapabilityInputSchema(filesystemWriteFileInputType, { clean: true });
const filesystemEntriesOutputSchema = defineCapabilityOutputSchema(Type.Array(filesystemEntryType), { clean: true });
const filesystemFileRefsOutputSchema = defineCapabilityOutputSchema(Type.Array(filesystemFileRefType), { clean: true });
const filesystemReadFileOutputSchema = defineCapabilityOutputSchema(filesystemReadFileResultType, { clean: true });
const filesystemReadBinaryFileOutputSchema = defineCapabilityOutputSchema(filesystemReadBinaryFileResultType, {
	clean: true,
});
const filesystemStatOutputSchema = defineCapabilityOutputSchema(Type.Union([Type.Null(), filesystemStatResultType]), {
	clean: true,
});
const filesystemNoOutputSchema = defineCapabilityNoOutputSchema();

export const FOUNDATION_FILESYSTEM_CAPABILITIES = {
	READ_DIRECTORY: defineCapability<FilesystemPathInput, FilesystemEntry[]>({
		id: "cap.foundation.vetta.fs.read-directory",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: filesystemPathInputSchema,
		output: filesystemEntriesOutputSchema,
	}),
	READ_FILE: defineCapability<FilesystemPathInput, FilesystemReadFileResult>({
		id: "cap.foundation.vetta.fs.read-file",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: filesystemPathInputSchema,
		output: filesystemReadFileOutputSchema,
	}),
	READ_BINARY_FILE: defineCapability<FilesystemPathInput, FilesystemReadBinaryFileResult>({
		id: "cap.foundation.vetta.fs.read-binary-file",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: filesystemPathInputSchema,
		output: filesystemReadBinaryFileOutputSchema,
	}),
	WRITE_FILE: defineCapability<FilesystemWriteFileInput, undefined>({
		id: "cap.foundation.vetta.fs.write-file",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: filesystemWriteFileInputSchema,
		output: filesystemNoOutputSchema,
	}),
	STAT: defineCapability<FilesystemPathInput, FilesystemStatResult | null>({
		id: "cap.foundation.vetta.fs.stat",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: filesystemPathInputSchema,
		output: filesystemStatOutputSchema,
	}),
	RENAME: defineCapability<FilesystemRenameInput, undefined>({
		id: "cap.foundation.vetta.fs.rename",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: filesystemRenameInputSchema,
		output: filesystemNoOutputSchema,
	}),
	DELETE: defineCapability<FilesystemPathInput, undefined>({
		id: "cap.foundation.vetta.fs.delete",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: filesystemPathInputSchema,
		output: filesystemNoOutputSchema,
	}),
	MOVE: defineCapability<FilesystemMoveInput, undefined>({
		id: "cap.foundation.vetta.fs.move",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: filesystemMoveInputSchema,
		output: filesystemNoOutputSchema,
	}),
	CREATE_DIRECTORY: defineCapability<FilesystemPathInput, undefined>({
		id: "cap.foundation.vetta.fs.create-directory",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: filesystemPathInputSchema,
		output: filesystemNoOutputSchema,
	}),
	LIST_FILES_RECURSIVE: defineCapability<FilesystemListRecursiveInput, FilesystemFileRef[]>({
		id: "cap.foundation.vetta.fs.list-files-recursive",
		kind: "query",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: filesystemListRecursiveInputSchema,
		output: filesystemFileRefsOutputSchema,
	}),
} as const;

export const FOUNDATION_FILESYSTEM_CAPABILITY_CATALOG = createCapabilityCatalog(
	Object.values(FOUNDATION_FILESYSTEM_CAPABILITIES),
);
