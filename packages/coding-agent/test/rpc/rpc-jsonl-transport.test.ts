import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import { RpcJsonlTransport } from "../../src/modes/rpc/rpc-jsonl-transport.js";

describe("RPC JSONL transport", () => {
	test("preserves line boundaries and emits one JSON object per write", async () => {
		const input = new PassThrough();
		const output = new PassThrough();
		const outputChunks: Buffer[] = [];
		output.on("data", (chunk: Buffer) => outputChunks.push(chunk));
		const lines: string[] = [];
		const closed = vi.fn();
		const transport = new RpcJsonlTransport(input, output);
		transport.start((line) => lines.push(line), closed);

		input.write('{"type":"get_state"}\n{"type":"abort"}\n');
		transport.write({ type: "response", command: "abort", success: true });
		await vi.waitFor(() => expect(lines).toEqual(['{"type":"get_state"}', '{"type":"abort"}']));

		expect(Buffer.concat(outputChunks).toString("utf8")).toBe(
			'{"type":"response","command":"abort","success":true}\n',
		);

		transport.close();
		await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce());
	});

	test("rejects duplicate starts", () => {
		const transport = new RpcJsonlTransport(new PassThrough(), new PassThrough());
		transport.start(
			() => {},
			() => {},
		);

		expect(() =>
			transport.start(
				() => {},
				() => {},
			),
		).toThrow("already started");
		transport.close();
	});
});
