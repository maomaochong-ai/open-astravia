import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const OcrCliResponseSchema = Type.Object(
	{
		ok: Type.Boolean(),
		output: Type.Optional(Type.String()),
		error: Type.Optional(
			Type.Object(
				{
					message: Type.String(),
				},
				{ additionalProperties: true },
			),
		),
	},
	{ additionalProperties: true },
);

const OcrPageResultSchema = Type.Object(
	{
		page: Type.Number(),
		text: Type.String(),
		source: Type.Union([Type.Literal("text-layer"), Type.Literal("ocr")]),
		width: Type.Number(),
		height: Type.Number(),
		ocrDurationMs: Type.Optional(Type.Number()),
		confidence: Type.Optional(Type.Number()),
	},
	{ additionalProperties: true },
);

const OcrJsonDocumentSchema = Type.Object(
	{
		version: Type.Number(),
		meta: Type.Record(Type.String(), Type.Unknown()),
		pages: Type.Array(OcrPageResultSchema),
	},
	{ additionalProperties: true },
);

export interface OcrCliResponse {
	readonly ok: boolean;
	readonly output?: string;
	readonly error?: { readonly message: string };
}

export interface OcrPageResult {
	readonly page: number;
	readonly text: string;
	readonly source: "text-layer" | "ocr";
	readonly width: number;
	readonly height: number;
	readonly ocrDurationMs?: number;
	readonly confidence?: number;
}

export interface OcrJsonDocument {
	readonly version: number;
	readonly meta: Readonly<Record<string, unknown>>;
	readonly pages: readonly OcrPageResult[];
}

export function parseOcrDesktopResponse(stdout: string): OcrCliResponse {
	const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
	for (let index = lines.length - 1; index >= 0; index--) {
		try {
			const parsed: unknown = JSON.parse(lines[index]);
			if (Value.Check(OcrCliResponseSchema, parsed)) return parsed;
		} catch {
			// Electron helpers may write non-JSON lines before the response.
		}
	}
	throw new Error("Vetta Desktop returned no parseable JSON on stdout");
}

export function parseOcrJsonDocument(raw: string): OcrJsonDocument {
	const parsed: unknown = JSON.parse(raw);
	if (!Value.Check(OcrJsonDocumentSchema, parsed)) {
		throw new Error("Vetta Desktop returned an invalid OCR document");
	}
	return parsed;
}
