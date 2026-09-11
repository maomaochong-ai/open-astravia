import { Type, type Static } from "@sinclair/typebox";
import { SkillSurfaceVisibilitySchema, SkillVisibilitySchema } from "@vetta/capability-sdk";
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
				/** `managed-binary` is the backwards-compatible default. */
				kind: Type.Optional(Type.Union([Type.Literal("managed-binary"), Type.Literal("host-node")])),
				version: PluginVersionSchema,
				/** Entry script relative to the installed runtime (required for host-node). */
				entry: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
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

/** HTTP MCP served by one of this plugin's managed local services. */
export const PluginMcpServiceServerConfigSchema = Type.Object(
	{
		...PluginMcpCommonProperties,
		type: Type.Literal("service"),
		serviceId: PluginIdSchema,
		path: Type.String({ pattern: "^/[^/]*" }),
	},
	{ additionalProperties: true },
);

export const PluginMcpServerConfigSchema = Type.Union([
	PluginMcpStdioServerConfigSchema,
	PluginMcpHttpServerConfigSchema,
	PluginMcpServiceServerConfigSchema,
]);

const PluginMcpServerMapSchema = Type.Record(
	Type.String({ pattern: NON_WHITESPACE_PATTERN }),
	PluginMcpServerConfigSchema,
	{ additionalProperties: false },
);

export const PluginSkillPresentationRuleSchema = Type.Object(
	{
		defaultVisibility: Type.Optional(SkillVisibilitySchema),
		surfaces: Type.Optional(SkillSurfaceVisibilitySchema),
		displayName: Type.Optional(NonWhitespaceStringSchema),
		displayDescription: Type.Optional(NonWhitespaceStringSchema),
	},
	{ additionalProperties: false },
);
export const PluginSkillPresentationSchema = Type.Object(
	{
		defaultVisibility: Type.Optional(SkillVisibilitySchema),
		surfaces: Type.Optional(SkillSurfaceVisibilitySchema),
		skills: Type.Optional(Type.Record(NonWhitespaceStringSchema, PluginSkillPresentationRuleSchema)),
	},
	{ additionalProperties: false },
);

/** 插件贡献的智能体（blueprint）。人设、头像、职责都由插件提供，宿主只负责铺档案。 */
export const PluginAgentProfileManifestSchema = Type.Object(
	{
		/** 插件内唯一；全局 id 由宿主拼成 `plugin:<pluginId>:<id>`。 */
		id: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" }),
		/** 支持 `%key%` 占位，按插件 locales 解析。 */
		name: NonWhitespaceStringSchema,
		description: Type.Optional(Type.String({ maxLength: 2_000 })),
		/** @ 提及用的短名；缺省用 `id`。 */
		mentionHandle: Type.Optional(Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" })),
		/** 插件包内的相对路径，指向头像图片。 */
		avatar: Type.Optional(NonWhitespaceStringSchema),
		/** 插件包内的相对路径，指向系统提示词 Markdown。与 `systemPrompt` 二选一。 */
		systemPromptPath: Type.Optional(NonWhitespaceStringSchema),
		systemPrompt: Type.Optional(Type.String({ maxLength: 64_000 })),
		/**
		 * `all`（默认）继承宿主全部已启用能力；`own` 只用本插件的能力。
		 * 两种模式下本插件的能力都强制激活，用户关不掉。
		 */
		abilities: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("own")])),
	},
	{ additionalProperties: false },
);

/**
 * 插件贡献的团队成员。
 *
 * `agent` 写本插件的智能体 id；引用宿主内置角色写 `builtin:<key>`（如 `builtin:master`）。
 * 刻意不支持引用别的插件——那会让一个插件的可用性取决于另一个插件是否安装。
 */
export const PluginAgentTeamMemberManifestSchema = Type.Object(
	{
		agent: NonWhitespaceStringSchema,
		responsibility: Type.String({ maxLength: 2_000 }),
	},
	{ additionalProperties: false },
);

/** 插件贡献的团队。第一个成员即队长，也是用户在会话里唯一的对话入口。 */
export const PluginAgentTeamManifestSchema = Type.Object(
	{
		id: Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,63}$" }),
		name: NonWhitespaceStringSchema,
		description: Type.Optional(Type.String({ maxLength: 2_000 })),
		members: Type.Array(PluginAgentTeamMemberManifestSchema, { minItems: 1, maxItems: 32 }),
		/** 队长的团队任务书：把这支团队的固定流水线写死。与 `workflowPath` 二选一。 */
		workflow: Type.Optional(Type.String({ maxLength: 64_000 })),
		workflowPath: Type.Optional(NonWhitespaceStringSchema),
	},
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
		skillPresentation: Type.Optional(PluginSkillPresentationSchema),
		agents: Type.Optional(Type.Array(PluginAgentProfileManifestSchema, { maxItems: 32 })),
		teams: Type.Optional(Type.Array(PluginAgentTeamManifestSchema, { maxItems: 32 })),
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
export type PluginAgentProfileManifest = Static<typeof PluginAgentProfileManifestSchema>;
export type PluginAgentTeamManifest = Static<typeof PluginAgentTeamManifestSchema>;
export type PluginAgentTeamMemberManifest = Static<typeof PluginAgentTeamMemberManifestSchema>;
export type PluginSkillPresentation = Static<typeof PluginSkillPresentationSchema>;
export type PluginSkillPresentationRule = Static<typeof PluginSkillPresentationRuleSchema>;
export type PluginCliProviderManifest = Static<typeof PluginCliProviderManifestSchema>;
export type PluginServiceArtifact = Static<typeof PluginServiceArtifactSchema>;
export type PluginServicePlatform = Static<typeof PluginServicePlatformSchema>;
export type PluginServiceProviderManifest = Static<typeof PluginServiceProviderManifestSchema>;
export type PluginServiceRuntimeKind = "managed-binary" | "host-node";
export type PluginProvidersManifest = Static<typeof PluginProvidersManifestSchema>;
export type PluginNetworkManifest = Static<typeof PluginNetworkManifestSchema>;
export type PluginBrowserManifest = Static<typeof PluginBrowserManifestSchema>;
export type PluginManifestInput = Static<typeof PluginManifestSchema>;
export type PluginManifest = PluginManifestInput;
