import type { CodingAgentPrintOutputPort } from "@vetta/coding-agent/bootstrap";

/** Node process transport for the platform-neutral Print mode. */
export const nodePrintOutput: CodingAgentPrintOutputPort = {
	writeLine: (value) => console.log(value),
	writeErrorLine: (value) => console.error(value),
	flush: () =>
		new Promise<void>((resolve, reject) => {
			process.stdout.write("", (error) => {
				if (error) reject(error);
				else resolve();
			});
		}),
	exit: (code) => process.exit(code),
};
