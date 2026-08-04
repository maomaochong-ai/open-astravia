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

export const PluginPermissionSchema = Type.Union(
	PLUGIN_PERMISSIONS.map((permission) => Type.Literal(permission)),
	{ description: "Host capability requested by the plugin." },
);

const NonWhitespaceStringSchema = Type.String({ pattern: NON_WHITESPACE_PATTERN });
const OptionalAgentModesSchema = Type.Optional(
	Type.Union([NonWhitespaceStringSchema, Type.Array(NonWhitespaceStringSchema)]),
);
const StringRecordSchema = Type.Record(Type.String(), Type.String());

const PluginSettingBaseProperties = {
	key: NonWhitespaceStringSchema,
	description: Type.Optional(Type.String()),
	default: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
	enum: Type.Optional(Type.Array(NonWhitespaceStringSchema)),
	visibleWhen: Type.Optional(
		Type.Object(
			{
				key: NonWhitespaceStringSchema,
				in: Type.Array(NonWhitespaceStringSchema),
			},
			{ additionalProperties: true },
		),
	),
};

const PluginInputSettingSchema = Type.Object(
	{
		...PluginSettingBaseProperties,
		type: Type.Union([
			Type.Literal("string"),
			Type.Literal("number"),
			Type.Literal("boolean"),
			Type.Literal("enum"),
			Type.Literal("secret"),
		]),
		title: NonWhitespaceStringSchema,
	},
	{ additionalProperties: true },
);

const PluginDescriptionSettingSchema = Type.Object(
	{
		...PluginSettingBaseProperties,
		type: Type.Literal("desc"),
		title: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);

export const PluginSettingDefinitionSchema = Type.Union([
	PluginInputSettingSchema,
	PluginDescriptionSettingSchema,
]);

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
		runtime: Type.Optional(Type.Union([Type.Literal("esm"), Type.Literal("module-federation")])),
		moduleFederation: Type.Optional(PluginModuleFederationManifestSchema),
		agent: Type.Optional(PluginAgentManifestSchema),
		styles: Type.Optional(Type.Array(NonWhitespaceStringSchema)),
		permissions: Type.Optional(Type.Array(PluginPermissionSchema)),
		commands: Type.Optional(PluginCommandNamesSchema),
		contributes: Type.Optional(
			Type.Object(
				{
					settings: Type.Optional(Type.Array(PluginSettingDefinitionSchema)),
				},
				{ additionalProperties: true },
			),
		),
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

export type PluginSettingSchema = Static<typeof PluginSettingDefinitionSchema>;
export type PluginMcpServerConfig = Static<typeof PluginMcpServerConfigSchema>;
export type PluginAgentManifest = Static<typeof PluginAgentManifestSchema>;
export type PluginManifestInput = Static<typeof PluginManifestSchema>;
export type PluginManifest = PluginManifestInput;
