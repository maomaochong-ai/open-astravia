import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { PluginIdSchema, PluginVersionSchema } from "./manifest-schema.js";
import { validatePluginRelativePath } from "./manifest.js";

export const ASTRAVIA_NPM_PACKAGE_SCHEMA_VERSION = 1 as const;

export const AstraviaNpmPluginMetadataSchema = Type.Object(
	{
		schemaVersion: Type.Literal(ASTRAVIA_NPM_PACKAGE_SCHEMA_VERSION),
		type: Type.Literal("desktop-plugin"),
		pluginId: PluginIdSchema,
		archive: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);

export type AstraviaNpmPluginMetadata = Static<typeof AstraviaNpmPluginMetadataSchema>;

export interface AstraviaNpmPluginPackage {
	name: string;
	version: string;
	astravia: AstraviaNpmPluginMetadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse the npm distribution envelope without trusting package-owned metadata. */
export function parseAstraviaNpmPluginPackage(value: unknown): AstraviaNpmPluginPackage {
	if (!isRecord(value)) throw new Error("Invalid npm plugin package: package.json must contain an object");
	if (typeof value.name !== "string" || value.name.trim().length === 0) {
		throw new Error("Invalid npm plugin package: name is required");
	}
	if (!Value.Check(PluginVersionSchema, value.version)) {
		throw new Error("Invalid npm plugin package: version must be a semantic version");
	}
	if (!Value.Check(AstraviaNpmPluginMetadataSchema, value.astravia)) {
		throw new Error("Invalid npm plugin package: package.json#astravia does not match schema version 1");
	}

	const metadata = value.astravia as AstraviaNpmPluginMetadata;
	return {
		name: value.name.trim(),
		version: value.version,
		astravia: {
			...metadata,
			archive: validatePluginRelativePath(metadata.archive.trim(), "npm archive"),
		},
	};
}
