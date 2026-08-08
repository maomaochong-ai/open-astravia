import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { SettingsDocument } from "../contracts/settings-document.js";
import { migrateSettingsDocument } from "../migration/migrate-settings.js";

const StringArraySchema = Type.Array(Type.String());
const PackageSourceSchema = Type.Union([
	Type.String(),
	Type.Object(
		{
			source: Type.String(),
			extensions: Type.Optional(StringArraySchema),
			skills: Type.Optional(StringArraySchema),
			prompts: Type.Optional(StringArraySchema),
			themes: Type.Optional(StringArraySchema),
		},
		{ additionalProperties: true },
	),
]);

export const SettingsDocumentSchema = Type.Object(
	{
		lastChangelogVersion: Type.Optional(Type.String()),
		defaultProvider: Type.Optional(Type.String()),
		defaultModel: Type.Optional(Type.String()),
		defaultThinkingLevel: Type.Optional(Type.String()),
		transport: Type.Optional(Type.Union([Type.Literal("sse"), Type.Literal("websocket"), Type.Literal("auto")])),
		steeringMode: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("one-at-a-time")])),
		followUpMode: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("one-at-a-time")])),
		theme: Type.Optional(Type.String()),
		compaction: Type.Optional(
			Type.Object(
				{
					enabled: Type.Optional(Type.Boolean()),
					reserveTokens: Type.Optional(Type.Number()),
					minFreePercent: Type.Optional(Type.Number()),
					keepRecentTokens: Type.Optional(Type.Number()),
				},
				{ additionalProperties: true },
			),
		),
		branchSummary: Type.Optional(
			Type.Object({ reserveTokens: Type.Optional(Type.Number()) }, { additionalProperties: true }),
		),
		retry: Type.Optional(
			Type.Object(
				{
					enabled: Type.Optional(Type.Boolean()),
					maxRetries: Type.Optional(Type.Number()),
					baseDelayMs: Type.Optional(Type.Number()),
					maxDelayMs: Type.Optional(Type.Number()),
				},
				{ additionalProperties: true },
			),
		),
		hideThinkingBlock: Type.Optional(Type.Boolean()),
		shellPath: Type.Optional(Type.String()),
		quietStartup: Type.Optional(Type.Boolean()),
		shellCommandPrefix: Type.Optional(Type.String()),
		collapseChangelog: Type.Optional(Type.Boolean()),
		packages: Type.Optional(Type.Array(PackageSourceSchema)),
		extensions: Type.Optional(StringArraySchema),
		skills: Type.Optional(StringArraySchema),
		prompts: Type.Optional(StringArraySchema),
		themes: Type.Optional(StringArraySchema),
		enableSkillCommands: Type.Optional(Type.Boolean()),
		terminal: Type.Optional(
			Type.Object(
				{
					showImages: Type.Optional(Type.Boolean()),
					clearOnShrink: Type.Optional(Type.Boolean()),
				},
				{ additionalProperties: true },
			),
		),
		images: Type.Optional(
			Type.Object(
				{
					autoResize: Type.Optional(Type.Boolean()),
					blockImages: Type.Optional(Type.Boolean()),
				},
				{ additionalProperties: true },
			),
		),
		personalization: Type.Optional(
			Type.Object(
				{
					personaId: Type.Optional(Type.String()),
					customPrompt: Type.Optional(Type.String()),
				},
				{ additionalProperties: true },
			),
		),
		enabledModels: Type.Optional(StringArraySchema),
		doubleEscapeAction: Type.Optional(Type.Union([Type.Literal("fork"), Type.Literal("tree"), Type.Literal("none")])),
		thinkingBudgets: Type.Optional(
			Type.Object(
				{
					minimal: Type.Optional(Type.Number()),
					low: Type.Optional(Type.Number()),
					medium: Type.Optional(Type.Number()),
					high: Type.Optional(Type.Number()),
				},
				{ additionalProperties: true },
			),
		),
		editorPaddingX: Type.Optional(Type.Number()),
		autocompleteMaxVisible: Type.Optional(Type.Number()),
		showHardwareCursor: Type.Optional(Type.Boolean()),
		markdown: Type.Optional(
			Type.Object({ codeBlockIndent: Type.Optional(Type.String()) }, { additionalProperties: true }),
		),
		enableMcp: Type.Optional(Type.Boolean()),
		mcpDebug: Type.Optional(Type.Boolean()),
		serverUrl: Type.Optional(Type.String()),
		serverToken: Type.Optional(Type.String()),
	},
	{ additionalProperties: true },
);

export function decodeSettingsDocument(content: string): SettingsDocument {
	const parsed: unknown = JSON.parse(content);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("Settings document must be a JSON object");
	}
	const migrated = migrateSettingsDocument(parsed as Record<string, unknown>);
	if (!Value.Check(SettingsDocumentSchema, migrated)) {
		const firstError = Value.Errors(SettingsDocumentSchema, migrated).First();
		throw new Error(`Invalid settings document${firstError ? ` at ${firstError.path}: ${firstError.message}` : ""}`);
	}
	return migrated as SettingsDocument;
}
