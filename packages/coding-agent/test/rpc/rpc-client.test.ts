import { describe, expect, it } from "vitest";
import {
	RpcClient,
	RpcClientError,
	type RpcClientTransport,
	type RpcClientTransportHandlers,
} from "../../src/public-api/rpc.js";

describe("portable RPC Client", () => {
	it("correlates typed commands and emits uncorrelated events", async () => {
		const transport = new TestRpcClientTransport();
		const client = new RpcClient(transport);
		await client.start();
		const events: unknown[] = [];
		client.onEvent((event) => events.push(event));

		const statePromise = client.getState();
		const command = transport.readLastCommand();
		expect(command).toMatchObject({ type: "get_state" });
		transport.emit({
			id: command.id,
			type: "response",
			command: "get_state",
			success: true,
			data: {
				thinkingLevel: "off",
				isStreaming: false,
				isCompacting: false,
				steeringMode: "all",
				followUpMode: "all",
				sessionId: "session-1",
				autoCompactionEnabled: true,
				messageCount: 0,
				pendingMessageCount: 0,
			},
		});
		transport.emit({ type: "agent_start" });

		await expect(statePromise).resolves.toMatchObject({ sessionId: "session-1" });
		expect(events).toEqual([{ type: "agent_start" }]);
		await client.stop();
	});

	it("maps failed responses and transport failures without Node process knowledge", async () => {
		const transport = new TestRpcClientTransport();
		const client = new RpcClient(transport);
		await client.start();

		const promptPromise = client.prompt("hello");
		const command = transport.readLastCommand();
		transport.emit({
			id: command.id,
			type: "response",
			command: "prompt",
			success: false,
			error: "provider failed",
			errorCode: "provider_unavailable",
			phase: "turn",
			recoverability: "continue_session",
		});
		await expect(promptPromise).rejects.toMatchObject({
			message: "provider failed",
			errorCode: "provider_unavailable",
			phase: "turn",
			recoverability: "continue_session",
		});

		const eventsPromise = client.collectEvents(5_000);
		transport.fail(
			new RpcClientError("transport closed", {
				errorCode: "process_exited",
				phase: "command",
				recoverability: "restart_session",
			}),
		);
		await expect(eventsPromise).rejects.toMatchObject({
			message: "transport closed",
			phase: "turn",
			recoverability: "restart_session",
		});

		await client.start();
		expect(transport.startCount).toBe(2);
		await client.stop();
	});
});

class TestRpcClientTransport implements RpcClientTransport {
	private handlers: RpcClientTransportHandlers | undefined;
	private active = false;
	readonly writes: string[] = [];
	startCount = 0;

	async start(handlers: RpcClientTransportHandlers): Promise<void> {
		if (this.active) throw new Error("transport already started");
		this.active = true;
		this.handlers = handlers;
		this.startCount += 1;
	}

	async stop(): Promise<void> {
		this.active = false;
	}

	write(line: string): void {
		if (!this.active) throw new Error("transport not started");
		this.writes.push(line);
	}

	getStderr(): string {
		return "";
	}

	emit(frame: unknown): void {
		this.handlers?.onLine(JSON.stringify(frame));
	}

	fail(error: RpcClientError): void {
		this.active = false;
		this.handlers?.onFailure(error);
	}

	readLastCommand(): { readonly id?: string; readonly type?: string } {
		const line = this.writes.at(-1);
		if (!line) throw new Error("No RPC command was written");
		return JSON.parse(line) as { readonly id?: string; readonly type?: string };
	}
}
