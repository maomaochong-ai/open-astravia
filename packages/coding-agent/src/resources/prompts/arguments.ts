import type { PromptTemplate } from "./contracts.js";

/** Parse command arguments while preserving quoted groups. */
export function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let inQuote: string | null = null;

	for (const char of argsString) {
		if (inQuote) {
			if (char === inQuote) inQuote = null;
			else current += char;
		} else if (char === '"' || char === "'") {
			inQuote = char;
		} else if (char === " " || char === "\t") {
			if (current) {
				args.push(current);
				current = "";
			}
		} else {
			current += char;
		}
	}

	if (current) args.push(current);
	return args;
}

/** Substitute positional, wildcard, and slice placeholders without recursively expanding argument values. */
export function substituteArgs(content: string, args: readonly string[]): string {
	let result = content.replace(/\$(\d+)/g, (_, number) => args[Number.parseInt(number, 10) - 1] ?? "");
	result = result.replace(/\$\{@:(\d+)(?::(\d+))?\}/g, (_, startText, lengthText) => {
		const start = Math.max(Number.parseInt(startText, 10) - 1, 0);
		return lengthText
			? args.slice(start, start + Number.parseInt(lengthText, 10)).join(" ")
			: args.slice(start).join(" ");
	});
	const allArgs = args.join(" ");
	return result.replace(/\$ARGUMENTS/g, allArgs).replace(/\$@/g, allArgs);
}

/** Expand a slash command when its name matches a captured template. */
export function expandPromptTemplate(text: string, templates: readonly PromptTemplate[]): string {
	if (!text.startsWith("/")) return text;

	const spaceIndex = text.indexOf(" ");
	const templateName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
	const argsString = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
	const template = templates.find((candidate) => candidate.name === templateName);
	return template ? substituteArgs(template.content, parseCommandArgs(argsString)) : text;
}
