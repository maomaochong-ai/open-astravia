import { Type, type Static } from "@sinclair/typebox";
import { PLUGIN_PERMISSIONS } from "./permissions.js";

const NON_WHITESPACE_PATTERN = "\\S";

export const PluginIdSchema = Type.String({
	minLength: 1,
	maxLength: 64,
	pattern: "^[a-z0-9][a-z0-9._-]{0,63}$",
	description: "Stable lowercase plugin identifier.",
});

export const PluginVersionSchema = Type.String({
	minLength: 1,
	maxLength: 64,
	pattern: "^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$",
	description: "Plugin version without path separators.",
});

export const PluginCommandNameSchema = Type.String({
	minLength: 1,
	maxLength: 64,
	pattern: "^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$",
	description: "Bare executable name declared by the plugin.",
});

export const PluginCommandNamesSchema = Type.Array(PluginCommandNameSchema);

const PluginCliCommandSchema = Type.Object(
	{
		command: PluginCommandNameSchema,
		args: Type.Optional(Type.Array(Type.String(), { maxItems: 64 })),
		timeoutMs: Type.Optional(Type.Number({ minimum: 1_000, maximum: 30 * 60_000 })),
	},
	{ additionalProperties: false },
);

export const PluginCliProviderManifestSchema = Type.Object(
	{
		id: PluginIdSchema,
		command: PluginCommandNameSchema,
		probe: Type.Optional(
			Type.Object(
				{
					args: Type.Optional(Type.Array(Type.String(), { maxItems: 64 })),
					timeoutMs: Type.Optional(Type.Number({ minimum: 1_000, maximum: 120_000 })),
				},
				{ additionalProperties: false },
			),
		),
		install: PluginCliCommandSchema,
	},
	{ additionalProperties: false },
);

const PluginServiceArchiveSchema = Type.Union([
	Type.Literal("file"),
	Type.Literal("zip"),
	Type.Literal("tar.gz"),
]);

export const PluginServiceArtifactSchema = Type.Object(
	{
		sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
		archive: PluginServiceArchiveSchema,
		/** Relative file (archive=file) or directory (archive=zip/tar.gz) below the managed runtime root. */
		destination: Type.String({ minLength: 1, maxLength: 512 }),
	},
	{ additionalProperties: false },
);

export const PluginServicePlatformSchema = Type.Object(
	{
		executable: Type.String({ minLength: 1, maxLength: 512 }),
		artifacts: Type.Array(PluginServiceArtifactSchema, { minItems: 1, maxItems: 8 }),
	},
	{ additionalProperties: false },
);

export const PluginServiceProviderManifestSchema = Type.Object(
	{
		id: PluginIdSchema,
		runtime: Type.Object(
			{
				version: PluginVersionSchema,
				platforms: Type.Record(
					Type.String({ pattern: "^(win32|darwin|linux)-(x64|arm64)$" }),
					PluginServicePlatformSchema,
				),
			},
			{ additionalProperties: false },
		),
		credentials: Type.Optional(
			Type.Array(
				Type.Object(
					{
						id: PluginIdSchema,
						bytes: Type.Optional(Type.Integer({ minimum: 16, maximum: 64 })),
					},
					{ additionalProperties: false },
				),
				{ minItems: 1, maxItems: 8 },
			),
		),
		templates: Type.Optional(
			Type.Array(
				Type.Object(
					{
						source: Type.String({ minLength: 1, maxLength: 512 }),
						destination: Type.String({ minLength: 1, maxLength: 512 }),
						/** create preserves a data file; render regenerates a cache file on every start. */
						mode: Type.Union([Type.Literal("create"), Type.Literal("render")]),
					},
					{ additionalProperties: false },
				),
				{ minItems: 1, maxItems: 16 },
			),
		),
		process: Type.Object(
			{
				args: Type.Optional(Type.Array(Type.String(), { maxItems: 64 })),
				env: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String())),
			},
			{ additionalProperties: false },
		),
		health: Type.Object(
			{
				path: Type.String({ minLength: 1, maxLength: 1_024, pattern: "^/[^/]*" }),
				credentialId: Type.Optional(PluginIdSchema),
				timeoutMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 120_000 })),
				readiness: Type.Optional(
					Type.Object({ mode: Type.Literal("plugin") }, { additionalProperties: false }),
				),
			},
			{ additionalProperties: false },
		),
	},
	{ additionalProperties: false },
);

export const PluginProvidersManifestSchema = Type.Object(
	{
		cli: Type.Optional(Type.Array(PluginCliProviderManifestSchema, { minItems: 1, maxItems: 16 })),
		services: Type.Optional(Type.Array(PluginServiceProviderManifestSchema, { minItems: 1, maxItems: 8 })),
	},
	{ additionalProperties: false },
);

export const PluginNetworkManifestSchema = Type.Object(
	{
		allowedHosts: Type.Array(Type.String({ minLength: 1, maxLength: 253, pattern: NON_WHITESPACE_PATTERN }), {
			minItems: 1,
			maxItems: 128,
		}),
	},
	{ additionalProperties: true },
);

export const PluginBrowserManifestSchema = Type.Object(
	{
		allowedHosts: Type.Array(Type.String({ minLength: 1, maxLength: 253, pattern: NON_WHITESPACE_PATTERN }), {
			minItems: 1,
			maxItems: 128,
		}),
	},
	{ additionalProperties: true },
);

export const PluginPermissionSchema = Type.Union(
	PLUGIN_PERMISSIONS.map((permission) => Type.Literal(permission)),
	{ description: "Host capability requested by the plugin." },
);

const NonWhitespaceStringSchema = Type.String({ pattern: NON_WHITESPACE_PATTERN });
const OptionalAgentModesSchema = Type.Optional(
	Type.Union([NonWhitespaceStringSchema, Type.Array(NonWhitespaceStringSchema)]),
);
const StringRecordSchema = Type.Record(Type.String(), Type.String());

const PluginMcpCommonProperties = {
	disabled: Type.Optional(Type.Boolean()),
	autoApprove: Type.Optional(Type.Array(NonWhitespaceStringSchema)),
	startupTimeout: Type.Optional(Type.Number()),
	debug: Type.Optional(Type.Boolean()),
	displayName: Type.Optional(Type.String()),
	description: Type.Optional(Type.String()),
	agent_mode: OptionalAgentModesSchema,
};

export const PluginMcpStdioServerConfigSchema = Type.Object(
	{
		...PluginMcpCommonProperties,
		type: Type.Optional(Type.Literal("stdio")),
		command: NonWhitespaceStringSchema,
		args: Type.Optional(Type.Array(Type.String())),
		env: Type.Optional(StringRecordSchema),
		cwd: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);

export const PluginMcpHttpServerConfigSchema = Type.Object(
	{
		...PluginMcpCommonProperties,
		type: Type.Literal("http"),
		url: NonWhitespaceStringSchema,
		headers: Type.Optional(StringRecordSchema),
		oauthClientId: Type.Optional(Type.String()),
		oauthDeviceFlow: Type.Optional(Type.Boolean()),
		oauthScopes: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);

export const PluginMcpServerConfigSchema = Type.Union([
	PluginMcpStdioServerConfigSchema,
	PluginMcpHttpServerConfigSchema,
]);

const PluginMcpServerMapSchema = Type.Record(
	Type.String({ pattern: NON_WHITESPACE_PATTERN }),
	PluginMcpServerConfigSchema,
	{ additionalProperties: false },
);

export const PluginAgentManifestSchema = Type.Object(
	{
		systemPrompt: Type.Optional(
			Type.Object(
				{
					promptPaths: Type.Optional(Type.Array(NonWhitespaceStringSchema)),
				},
				{ additionalProperties: true },
			),
		),
		skillPaths: Type.Optional(Type.Array(NonWhitespaceStringSchema)),
		mcpServers: Type.Optional(Type.Union([NonWhitespaceStringSchema, PluginMcpServerMapSchema])),
		toolPolicy: Type.Optional(
			Type.Object(
				{
					allow: Type.Optional(Type.Array(NonWhitespaceStringSchema)),
					deny: Type.Optional(Type.Array(NonWhitespaceStringSchema)),
				},
				{ additionalProperties: true },
			),
		),
	},
	{ additionalProperties: true },
);

export const PluginModuleFederationManifestSchema = Type.Object(
	{
		remoteName: Type.String({ pattern: "^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$" }),
		expose: Type.String({ pattern: "^\\./(?!.*\\.\\.)(?!.*\\\\).+$" }),
	},
	{ additionalProperties: true },
);

export const PluginManifestSchema = Type.Object(
	{
		id: PluginIdSchema,
		name: NonWhitespaceStringSchema,
		version: PluginVersionSchema,
		pluginApiVersion: NonWhitespaceStringSchema,
		entry: NonWhitespaceStringSchema,
		moduleFederation: PluginModuleFederationManifestSchema,
		agent: Type.Optional(PluginAgentManifestSchema),
		providers: Type.Optional(PluginProvidersManifestSchema),
		styles: Type.Optional(Type.Array(NonWhitespaceStringSchema)),
		permissions: Type.Optional(Type.Array(PluginPermissionSchema)),
		network: Type.Optional(PluginNetworkManifestSchema),
		browser: Type.Optional(PluginBrowserManifestSchema),
		commands: Type.Optional(PluginCommandNamesSchema),
		description: Type.Optional(Type.String()),
		author: Type.Optional(Type.String()),
		icon: Type.Optional(NonWhitespaceStringSchema),
		guidingWords: Type.Optional(Type.Array(NonWhitespaceStringSchema)),
		defaultLocale: Type.Optional(
			Type.String({ minLength: 2, maxLength: 16, pattern: "^[a-zA-Z][a-zA-Z0-9-]{1,15}$" }),
		),
		contributionMode: Type.Optional(
			Type.Object(
				{
					hardIsolation: Type.Optional(Type.Boolean()),
				},
				{ additionalProperties: true },
			),
		),
		agent_mode: OptionalAgentModesSchema,
	},
	{
		$id: "PluginManifest",
		additionalProperties: true,
		description: "Vetta desktop plugin manifest (plugin.json).",
	},
);

export type PluginMcpServerConfig = Static<typeof PluginMcpServerConfigSchema>;
export type PluginAgentManifest = Static<typeof PluginAgentManifestSchema>;
export type PluginCliProviderManifest = Static<typeof PluginCliProviderManifestSchema>;
export type PluginServiceArtifact = Static<typeof PluginServiceArtifactSchema>;
export type PluginServicePlatform = Static<typeof PluginServicePlatformSchema>;
export type PluginServiceProviderManifest = Static<typeof PluginServiceProviderManifestSchema>;
export type PluginProvidersManifest = Static<typeof PluginProvidersManifestSchema>;
export type PluginNetworkManifest = Static<typeof PluginNetworkManifestSchema>;
export type PluginBrowserManifest = Static<typeof PluginBrowserManifestSchema>;
export type PluginManifestInput = Static<typeof PluginManifestSchema>;
export type PluginManifest = PluginManifestInput;
