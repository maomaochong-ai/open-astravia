import remarkMath from "remark-math";

interface MarkdownNode {
	type: string;
	value?: string;
	lang?: string;
	children?: MarkdownNode[];
	position?: { start: { offset?: number }; end: { offset?: number } };
	data?: { hName: string; hProperties: Record<string, string> };
}

/** Keep raw markup out of the host DOM. Only standalone HTML and complete SVG become previews. */
export function remarkRichMarkup() {
	return (tree: MarkdownNode, file: { value: unknown }): void => {
		const markdown = String(file.value);
		function visit(parent: MarkdownNode) {
			const children = parent.children;
			if (!children) return;
			for (let index = 0; index < children.length; index++) {
				const node = children[index];
				if (node.type !== "html") {
					visit(node);
					continue;
				}
				const source = node.value ?? "";
				if (parent.type === "root" && /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(source)) {
					const start = node.position?.start.offset;
					if (start !== undefined) {
						const rest = markdown.slice(start);
						const closing = /<\/html\s*>/i.exec(rest);
						if (closing) {
							const end = start + closing.index + closing[0].length;
							let count = 1;
							while (
								index + count < children.length &&
								(children[index + count].position?.start.offset ?? end) < end
							)
								count++;
							const through = children[index + count - 1].position?.end.offset ?? end;
							children.splice(index, count, {
								type: "code",
								lang: "html",
								value: markdown.slice(start, through),
							});
							continue;
						}
					}
				}
				if (/^\s*<svg[\s>]/i.test(source)) {
					const start = node.position?.start.offset;
					if (start === undefined) continue;
					const closing = /<\/svg\s*>/i.exec(markdown.slice(start));
					if (!closing) continue;
					const end = start + closing.index + closing[0].length;
					let count = 1;
					while (index + count < children.length && (children[index + count].position?.start.offset ?? end) < end)
						count++;
					// Slice the source once: text inside SVG may have been parsed as Markdown,
					// and rescanning an ever-growing concatenation would be quadratic.
					if ((children[index + count - 1].position?.end.offset ?? 0) <= end) {
						children.splice(index, count, {
							type: "richSvg",
							data: { hName: "vetta-svg", hProperties: { source: markdown.slice(start, end) } },
							children: [],
						});
					}
				} else if (
					parent.type === "root" &&
					/^\s*(?:<!doctype\s+html|<(?:html|div|section|article|main|style|table|body|head)[\s>])/i.test(source)
				) {
					children[index] = { type: "code", lang: "html", value: source };
				}
			}
		}
		visit(tree);
	};
}

export const richRemarkPlugins = [remarkMath, remarkRichMarkup];
