import type { Extension } from "mdast-util-from-markdown";
import type { Tokenizer } from "micromark-util-types";
import type { Processor } from "unified";

declare module "micromark-util-types" {
	interface TokenTypeMap {
		vettaMath: "vettaMath";
	}
}

const tokenize: Tokenizer = (effects, ok, nok) => {
	let closing = 41;
	let count = 0;
	return start;
	function start(code: number | null) {
		effects.enter("vettaMath");
		effects.consume(code);
		return delimiter;
	}
	function delimiter(code: number | null) {
		if (code !== 40 && code !== 91) return nok(code);
		closing = code === 40 ? 41 : 93;
		effects.consume(code);
		return body;
	}
	function body(code: number | null): ReturnType<Tokenizer> | undefined {
		if (code === null || ++count > 16_000) return nok(code);
		effects.consume(code);
		return code === 92 ? end : body;
	}
	function end(code: number | null): ReturnType<Tokenizer> | undefined {
		if (code === closing) {
			effects.consume(code);
			effects.exit("vettaMath");
			return ok;
		}
		if (code === 40 || code === 91) return nok(code);
		// A doubled slash is TeX's line break, not a closing delimiter.
		if (code === 92) {
			effects.consume(code);
			return body;
		}
		return body(code);
	}
};

/** Tokenize before Markdown escaping; fenced/inline code and link destinations remain untouched. */
export function remarkMathAliases(this: Processor) {
	const data = this.data();
	data.micromarkExtensions ??= [];
	data.micromarkExtensions.push({ text: { 92: { name: "vettaMath", tokenize } } });
	const extension: Extension = {
		enter: {
			vettaMath(token) {
				const raw = this.sliceSerialize(token);
				this.enter(
					{
						type: "inlineMath",
						value: raw.slice(2, -2),
						data: {
							hName: "code",
							hProperties: { className: ["language-math", raw[1] === "[" ? "math-display" : "math-inline"] },
							hChildren: [{ type: "text", value: raw.slice(2, -2) }],
						},
					},
					token,
				);
			},
		},
		exit: {
			vettaMath(token) {
				this.exit(token);
			},
		},
	};
	data.fromMarkdownExtensions ??= [];
	data.fromMarkdownExtensions.push(extension);
}

import type {} from "remark-parse";
