import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, truncateTail } from "@vetta/runtime-tools/coding";
import stripAnsi from "strip-ansi";
import { sanitizeBinaryOutput } from "./command-output.js";
import type { HostBashExecutionOptions, HostBashResult } from "./contracts.js";

/** 在本地进程和远程 Operations 之间复用完全相同的输出处理语义。 */
export class BashOutputCollector {
	private readonly decoder = new TextDecoder();
	private readonly outputChunks: string[] = [];
	private outputBytes = 0;
	private totalBytes = 0;
	private tempFilePath: string | undefined;
	private tempFileStream: WriteStream | undefined;

	constructor(private readonly options?: HostBashExecutionOptions) {}

	accept(data: Buffer): void {
		this.totalBytes += data.length;
		const text = sanitizeBinaryOutput(stripAnsi(this.decoder.decode(data, { stream: true }))).replace(/\r/g, "");

		if (this.totalBytes > DEFAULT_MAX_BYTES && !this.tempFilePath) {
			const id = randomBytes(8).toString("hex");
			this.tempFilePath = join(tmpdir(), `pi-bash-${id}.log`);
			this.tempFileStream = createWriteStream(this.tempFilePath);
			for (const chunk of this.outputChunks) this.tempFileStream.write(chunk);
		}
		this.tempFileStream?.write(text);

		this.outputChunks.push(text);
		this.outputBytes += text.length;
		const maxOutputBytes = DEFAULT_MAX_BYTES * 2;
		while (this.outputBytes > maxOutputBytes && this.outputChunks.length > 1) {
			const removed = this.outputChunks.shift();
			if (removed === undefined) break;
			this.outputBytes -= removed.length;
		}

		this.options?.onChunk?.(text);
	}

	finish(exitCode: number | undefined, cancelled: boolean): HostBashResult {
		this.close();
		const fullOutput = this.outputChunks.join("");
		const truncation = truncateTail(fullOutput);
		return {
			output: truncation.truncated ? truncation.content : fullOutput,
			exitCode: cancelled ? undefined : exitCode,
			cancelled,
			truncated: truncation.truncated,
			fullOutputPath: this.tempFilePath,
		};
	}

	close(): void {
		this.tempFileStream?.end();
	}
}
