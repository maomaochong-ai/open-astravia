import type { AgentMessage } from "@vetta/agent-core";
import type { ImageContent } from "@vetta/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPrintMode } from "../src/modes/print-mode.js";
import type { PrintExtensionError, PrintSessionCapabilities } from "../src/modes/print-session-capabilities.js";

function createTestOutput(output: string[], errors: string[]) {
	return {
		writeLine: (value: string) => output.push(value),
		writeErrorLine: (value: string) => errors.push(value),
		flush: async () => {},
		exit: (code: number): never => {
			throw new Error(`exit:${code}`);
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Print mode host contract", () => {
	it("drives JSON output through neutral session capabilities", async () => {
		const output: string[] = [];
		const errors: string[] = [];
		const session = new FakePrintSession();
		const images: ImageContent[] = [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }];

		await runPrintMode(
			session,
			{
				mode: "json",
				initialMessage: "first",
				initialImages: images,
				messages: ["second"],
			},
			createTestOutput(output, errors),
		);

		expect(session.initialized).toBe(true);
		expect(session.prompts).toEqual([
			{ message: "first", images },
			{ message: "second", images: undefined },
		]);
		expect(output.map((line) => JSON.parse(line))).toEqual([
			{ type: "session", id: "print-test" },
			{ type: "prompt", message: "first" },
			{ type: "prompt", message: "second" },
		]);
		expect(errors).toEqual(["Extension error (fixture-extension.ts): fixture failure"]);
	});
});

class FakePrintSession implements PrintSessionCapabilities {
	readonly prompts: Array<{ readonly message: string; readonly images?: readonly ImageContent[] }> = [];
	initialized = false;
	private listener: ((event: unknown) => void) | undefined;

	readHeader(): unknown {
		return { type: "session", id: "print-test" };
	}

	async initializeExtensions(onError: (error: PrintExtensionError) => void): Promise<void> {
		this.initialized = true;
		onError({ extensionPath: "fixture-extension.ts", error: "fixture failure" });
	}

	subscribe(listener: (event: unknown) => void): () => void {
		this.listener = listener;
		return () => {
			this.listener = undefined;
		};
	}

	async prompt(message: string, options?: { readonly images?: readonly ImageContent[] }): Promise<void> {
		this.prompts.push({ message, images: options?.images });
		this.listener?.({ type: "prompt", message });
	}

	readMessages(): readonly AgentMessage[] {
		return [];
	}
}
