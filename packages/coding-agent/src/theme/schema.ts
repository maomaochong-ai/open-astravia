import { type Static, Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";

const ColorValueSchema = Type.Union([Type.String(), Type.Integer({ minimum: 0, maximum: 255 })]);

export const ThemeDocumentSchema = Type.Object({
	$schema: Type.Optional(Type.String()),
	name: Type.String(),
	vars: Type.Optional(Type.Record(Type.String(), ColorValueSchema)),
	colors: Type.Object({
		accent: ColorValueSchema,
		border: ColorValueSchema,
		borderAccent: ColorValueSchema,
		borderMuted: ColorValueSchema,
		success: ColorValueSchema,
		error: ColorValueSchema,
		warning: ColorValueSchema,
		muted: ColorValueSchema,
		dim: ColorValueSchema,
		text: ColorValueSchema,
		thinkingText: ColorValueSchema,
		selectedBg: ColorValueSchema,
		userMessageBg: ColorValueSchema,
		userMessageText: ColorValueSchema,
		customMessageBg: ColorValueSchema,
		customMessageText: ColorValueSchema,
		customMessageLabel: ColorValueSchema,
		toolPendingBg: ColorValueSchema,
		toolSuccessBg: ColorValueSchema,
		toolErrorBg: ColorValueSchema,
		toolTitle: ColorValueSchema,
		toolOutput: ColorValueSchema,
		mdHeading: ColorValueSchema,
		mdLink: ColorValueSchema,
		mdLinkUrl: ColorValueSchema,
		mdCode: ColorValueSchema,
		mdCodeBlock: ColorValueSchema,
		mdCodeBlockBorder: ColorValueSchema,
		mdQuote: ColorValueSchema,
		mdQuoteBorder: ColorValueSchema,
		mdHr: ColorValueSchema,
		mdListBullet: ColorValueSchema,
		toolDiffAdded: ColorValueSchema,
		toolDiffRemoved: ColorValueSchema,
		toolDiffContext: ColorValueSchema,
		syntaxComment: ColorValueSchema,
		syntaxKeyword: ColorValueSchema,
		syntaxFunction: ColorValueSchema,
		syntaxVariable: ColorValueSchema,
		syntaxString: ColorValueSchema,
		syntaxNumber: ColorValueSchema,
		syntaxType: ColorValueSchema,
		syntaxOperator: ColorValueSchema,
		syntaxPunctuation: ColorValueSchema,
		thinkingOff: ColorValueSchema,
		thinkingMinimal: ColorValueSchema,
		thinkingLow: ColorValueSchema,
		thinkingMedium: ColorValueSchema,
		thinkingHigh: ColorValueSchema,
		thinkingXhigh: ColorValueSchema,
		bashMode: ColorValueSchema,
	}),
	export: Type.Optional(
		Type.Object({
			pageBg: Type.Optional(ColorValueSchema),
			cardBg: Type.Optional(ColorValueSchema),
			infoBg: Type.Optional(ColorValueSchema),
		}),
	),
});

export type ThemeDocument = Static<typeof ThemeDocumentSchema>;

const validateThemeDocument = TypeCompiler.Compile(ThemeDocumentSchema);

export function isThemeDocument(value: unknown): value is ThemeDocument {
	return validateThemeDocument.Check(value);
}

export function parseThemeDocument(label: string, value: unknown): ThemeDocument {
	if (!validateThemeDocument.Check(value)) {
		const missingColors: string[] = [];
		const otherErrors: string[] = [];
		for (const error of validateThemeDocument.Errors(value)) {
			const match = error.path.match(/^\/colors\/(\w+)$/);
			if (match && error.message.includes("Required")) {
				missingColors.push(match[1]);
			} else {
				otherErrors.push(`  - ${error.path}: ${error.message}`);
			}
		}

		let message = `Invalid theme "${label}":\n`;
		if (missingColors.length > 0) {
			message += "\nMissing required color tokens:\n";
			message += missingColors.map((color) => `  - ${color}`).join("\n");
			message += '\n\nPlease add these colors to your theme\'s "colors" object.';
			message += "\nSee the built-in themes (dark.json, light.json) for reference values.";
		}
		if (otherErrors.length > 0) {
			message += `\n\nOther errors:\n${otherErrors.join("\n")}`;
		}
		throw new Error(message);
	}
	return value;
}

export function parseThemeDocumentContent(label: string, content: string): ThemeDocument {
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch (error) {
		throw new Error(`Failed to parse theme ${label}: ${error}`);
	}
	return parseThemeDocument(label, value);
}
