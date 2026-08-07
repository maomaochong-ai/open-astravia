import type { ImageContent } from "@vetta/ai";
import type { Args } from "../cli/args.js";
import { processFileArguments } from "../cli/file-processor.js";
import type { PrintModeOptions } from "../modes/print-mode.js";

export interface PrepareCodingAgentPrintInvocationOptions {
	readonly parsed: Args;
	readonly autoResizeImages: boolean;
	readonly readStdin?: () => Promise<string | undefined>;
	readonly stdinPrepared?: boolean;
}

export type CodingAgentPrintInvocation =
	| { readonly kind: "print"; readonly options: PrintModeOptions }
	| { readonly kind: "interactive-unsupported" };

/** Prepare host input once so historical and native Print paths keep identical CLI semantics. */
export async function prepareCodingAgentPrintInvocation(
	options: PrepareCodingAgentPrintInvocationOptions,
): Promise<CodingAgentPrintInvocation> {
	const { parsed } = options;
	if (parsed.mode === "rpc") throw new Error("Print invocation does not support RPC mode");

	if (!options.stdinPrepared) await prepareCodingAgentPipedStdin(parsed, options.readStdin);

	const { initialMessage, initialImages } = await prepareInitialMessage(parsed, options.autoResizeImages);
	if (!parsed.print && parsed.mode === undefined) return { kind: "interactive-unsupported" };

	return {
		kind: "print",
		options: {
			mode: parsed.mode ?? "text",
			messages: parsed.messages,
			initialMessage,
			initialImages,
		},
	};
}

export async function prepareCodingAgentPipedStdin(
	parsed: Args,
	readStdin: () => Promise<string | undefined> = readPipedStdin,
): Promise<void> {
	const stdinContent = await readStdin();
	if (stdinContent === undefined) return;
	parsed.print = true;
	parsed.messages.unshift(stdinContent);
}

async function readPipedStdin(): Promise<string | undefined> {
	if (process.stdin.isTTY) return undefined;
	return new Promise((resolve) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data.trim() || undefined));
		process.stdin.resume();
	});
}

async function prepareInitialMessage(
	parsed: Args,
	autoResizeImages: boolean,
): Promise<{ readonly initialMessage?: string; readonly initialImages?: ImageContent[] }> {
	if (parsed.fileArgs.length === 0) return {};
	const { text, images } = await processFileArguments(parsed.fileArgs, { autoResizeImages });
	const firstMessage = parsed.messages.shift();
	return {
		initialMessage: `${text}${firstMessage ?? ""}`,
		initialImages: images.length > 0 ? images : undefined,
	};
}
