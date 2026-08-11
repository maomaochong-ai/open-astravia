import * as readline from "node:readline";
import type { Readable, Writable } from "node:stream";

export class RpcJsonlTransport {
	private reader: readline.Interface | undefined;

	constructor(
		private readonly input: Readable,
		private readonly output: Writable,
	) {}

	write(frame: unknown): void {
		this.output.write(`${JSON.stringify(frame)}\n`);
	}

	start(onLine: (line: string) => void, onClose: () => void): void {
		if (this.reader) throw new Error("RPC JSONL transport already started");
		const reader = readline.createInterface({
			input: this.input,
			output: this.output,
			terminal: false,
		});
		this.reader = reader;
		reader.on("line", onLine);
		reader.once("close", onClose);
	}

	close(): void {
		this.reader?.close();
	}
}
