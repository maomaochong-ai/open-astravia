import { Type } from "@sinclair/typebox";

/**
 * This schema guards an OpenAI-*compatible* wire format, not OpenAI itself: any relay, gateway or
 * self-hosted runtime can sit behind `openai-completions`. It therefore only requires what the
 * adapter actually consumes, and every field the adapter already guards at runtime stays optional.
 *
 * Observed deviations that must not fail a stream:
 * - `finish_reason: ""` on every non-terminal chunk (relays fronting Hunyuan / Kimi), and vendor
 *   values outside the OpenAI enum (`eos`, `end_turn`, ...). `mapStopReason` folds unknown values.
 * - `index` omitted; the adapter never reads it.
 * - `delta` omitted on the terminal usage-only chunk; the adapter already skips those.
 */
const finishReasonSchema = Type.Union([Type.String(), Type.Null()]);

export const openAIChatCompletionChunkSchema = Type.Object(
	{
		choices: Type.Array(
			Type.Object(
				{
					index: Type.Optional(Type.Number()),
					delta: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
					finish_reason: Type.Optional(finishReasonSchema),
				},
				{ additionalProperties: true },
			),
		),
		usage: Type.Optional(Type.Unknown()),
	},
	{ additionalProperties: true },
);
