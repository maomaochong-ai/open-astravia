import type { CodingToolRegistration } from "@vetta/runtime-tools";
import type { AsyncExecutionGate, CommandProcessPort } from "../shared/desktop-command.js";
import { createDocToPdfToolRegistration } from "../tools/doc-to-pdf/index.js";
import { createExtractTextFromImageToolRegistration } from "../tools/extract-text-from-image/index.js";
import { createExtractTextFromPdfToolRegistration } from "../tools/extract-text-from-pdf/index.js";
import { createHtmlToPdfToolRegistration } from "../tools/html-to-pdf/index.js";
import {
	createRenderPdfPageToolRegistration,
	RenderPdfPageProcessAbortedError,
} from "../tools/render-pdf-page/index.js";
import { createNodeCommandProcessHost, NodeCommandProcessAbortedError } from "./command-process.js";
import { createNodeDocToPdfOperations } from "./doc-to-pdf-operations.js";
import { createNodeVettaDesktopCommandPort } from "./vetta-desktop-command-port.js";

export interface NodeSpecializedToolRegistrationOptions {
	readonly executionGate: AsyncExecutionGate;
	readonly commandProcess?: CommandProcessPort;
}

/** Creates the Node-backed document and OCR registrations for one session cwd. */
export function createNodeSpecializedToolRegistrations(
	cwd: string,
	options: NodeSpecializedToolRegistrationOptions,
): readonly CodingToolRegistration[] {
	const commandProcess = options.commandProcess ?? createNodeCommandProcessHost();
	const desktop = createNodeVettaDesktopCommandPort({ commandProcess });

	return [
		createDocToPdfToolRegistration(cwd, {
			operations: createNodeDocToPdfOperations({ commandProcess }),
		}),
		createHtmlToPdfToolRegistration(cwd, { desktop }),
		createExtractTextFromPdfToolRegistration(cwd, {
			desktop,
			process: desktop,
			executionGate: options.executionGate,
		}),
		createExtractTextFromImageToolRegistration(cwd, {
			desktop,
			executionGate: options.executionGate,
		}),
		createRenderPdfPageToolRegistration(cwd, {
			process: {
				async run(args, signal) {
					try {
						return await commandProcess.run("pdftoppm", args, {
							signal,
							timeoutMs: 5 * 60 * 1_000,
							maxBufferBytes: 4 * 1_024 * 1_024,
						});
					} catch (error) {
						if (error instanceof NodeCommandProcessAbortedError) {
							throw new RenderPdfPageProcessAbortedError();
						}
						throw error;
					}
				},
			},
		}),
	];
}
