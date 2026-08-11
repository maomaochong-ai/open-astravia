import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin });

input.on("line", (line) => {
	const message = JSON.parse(line);
	if (message.method === "notifications/initialized") return;
	if (message.method === "initialize") {
		respond(message.id, {
			protocolVersion: "2024-11-05",
			serverInfo: { name: "fixture", version: "1.0.0" },
			capabilities: { tools: {}, resources: {}, prompts: {} },
		});
		return;
	}
	if (message.method === "tools/list") {
		respond(message.id, {
			tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }],
			nextCursor: message.params?.cursor ? undefined : "tools-next",
		});
		return;
	}
	if (message.method === "tools/call") {
		if (message.params?.name === "timeout") return;
		if (message.params?.name === "exit") {
			setTimeout(() => process.exit(7), 10);
			return;
		}
		if (message.params?.name === "error") {
			write({
				jsonrpc: "2.0",
				id: message.id,
				error: { code: -32001, message: "fixture failure", data: { reason: "expected" } },
			});
			return;
		}
		respond(message.id, { content: [{ type: "text", text: JSON.stringify(message.params?.arguments ?? {}) }] });
		return;
	}
	if (message.method === "resources/list") {
		respond(message.id, { resources: [{ uri: "fixture://resource", name: "fixture" }] });
		return;
	}
	if (message.method === "resources/read") {
		respond(message.id, { contents: [{ type: "text", text: message.params?.uri ?? "" }] });
		return;
	}
	if (message.method === "prompts/list") {
		respond(message.id, { prompts: [{ name: "fixture-prompt", description: "Fixture" }] });
	}
});

function respond(id, result) {
	write({ jsonrpc: "2.0", id, result });
}

function write(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}
