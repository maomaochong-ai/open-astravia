import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
	RUNTIME_CANARY_BATCH_PROMPT,
	RUNTIME_CANARY_FIRST_PROMPT,
	RUNTIME_CANARY_KNOWLEDGE_COMPLETE,
	RUNTIME_CANARY_KNOWLEDGE_FAILURE_SOURCE_PATH,
	RUNTIME_CANARY_KNOWLEDGE_PENDING_SOURCE_PATH,
	RUNTIME_CANARY_KNOWLEDGE_SOURCE_PATH,
	RUNTIME_CANARY_MCP_PROMPT,
	RUNTIME_CANARY_MCP_RESULT,
	RUNTIME_CANARY_MODEL_ID,
	RUNTIME_CANARY_MODEL_KEY,
	RUNTIME_CANARY_MODEL_PROVIDER,
	RUNTIME_CANARY_QUESTION,
	RUNTIME_CANARY_QUESTION_PROMPT,
	RUNTIME_CANARY_RESTART_PROMPT,
	RUNTIME_CANARY_SCHEDULER_PROMPT,
	RUNTIME_CANARY_SECOND_PROMPT,
	RUNTIME_CANARY_SKILL_MARKER,
	type RuntimeCanaryFixture,
} from "./contracts.js";

const providerRequestSchema = z
	.object({
		model: z.string(),
		input: z.array(z.unknown()),
		stream: z.literal(true),
	})
	.loose();

export interface RuntimeCanaryProvider {
	readonly fixture: RuntimeCanaryFixture;
	close(): Promise<void>;
}

export async function startRuntimeCanaryProvider(rootDir: string): Promise<RuntimeCanaryProvider> {
	const vettaHome = join(rootDir, "home");
	const agentDir = join(vettaHome, "agent");
	const workspace = join(rootDir, "workspace");
	const batchSourceDirectories: [string, string] = [
		join(rootDir, "batch-source-one"),
		join(rootDir, "batch-source-two"),
	];
	const requestLogPath = join(rootDir, "provider-requests.ndjson");
	const knowledgeRoot = join(vettaHome, "knowledges");
	const knowledgeSourceContent = "Runtime Canary Knowledge Source";
	const knowledgeSourceHash = createHash("sha256").update(knowledgeSourceContent).digest("hex");
	const installedCliPath = join(agentDir, "bin", process.platform === "win32" ? "vetta.exe" : "vetta");
	await Promise.all([
		mkdir(agentDir, { recursive: true }),
		mkdir(workspace, { recursive: true }),
		mkdir(dirname(join(knowledgeRoot, "raws", RUNTIME_CANARY_KNOWLEDGE_SOURCE_PATH)), { recursive: true }),
		...batchSourceDirectories.map((directory) => mkdir(directory, { recursive: true })),
	]);
	await Promise.all([
		...batchSourceDirectories.map((directory, index) =>
			writeFile(join(directory, "input.txt"), `Runtime Canary Batch Source ${index + 1}`),
		),
		writeFile(join(knowledgeRoot, "raws", RUNTIME_CANARY_KNOWLEDGE_SOURCE_PATH), knowledgeSourceContent),
	]);

	const server = createServer(async (request, response) => {
		if (request.method !== "POST" || request.url !== "/responses") {
			response.writeHead(404).end();
			return;
		}
		try {
			const rawBody = await readBody(request);
			const body = providerRequestSchema.parse(JSON.parse(rawBody));
			await writeFile(requestLogPath, `${rawBody}\n`, { flag: "a" });
			const serializedInput = JSON.stringify(body.input);
			const serializedLatestInput = JSON.stringify(body.input.at(-1));
			if (
				serializedLatestInput.includes(RUNTIME_CANARY_SCHEDULER_PROMPT) ||
				serializedLatestInput.includes(RUNTIME_CANARY_BATCH_PROMPT)
			) {
				writePendingResponse(response);
			} else if (serializedInput.includes(RUNTIME_CANARY_KNOWLEDGE_PENDING_SOURCE_PATH)) {
				writePendingResponse(response);
			} else if (serializedInput.includes(RUNTIME_CANARY_KNOWLEDGE_FAILURE_SOURCE_PATH)) {
				response.writeHead(500, { "content-type": "text/plain" });
				response.end("Runtime Canary Knowledge provider failure");
			} else if (
				serializedInput.includes(RUNTIME_CANARY_KNOWLEDGE_SOURCE_PATH) &&
				serializedLatestInput.includes("Updated #1") &&
				serializedLatestInput.includes("done")
			) {
				writeEvents(response, textResponseEvents(RUNTIME_CANARY_KNOWLEDGE_COMPLETE));
			} else if (
				serializedInput.includes(RUNTIME_CANARY_KNOWLEDGE_SOURCE_PATH) &&
				serializedLatestInput.includes("kb_write_page create ok")
			) {
				writeEvents(
					response,
					toolCallResponseEvents("todo", {
						description: "Complete the Runtime Canary knowledge item",
						action: "update",
						id: 1,
						status: "done",
					}),
				);
			} else if (serializedInput.includes(RUNTIME_CANARY_KNOWLEDGE_SOURCE_PATH)) {
				writeEvents(
					response,
					toolCallResponseEvents("kb_write_page", {
						description: "Write the Runtime Canary knowledge page",
						path: "runtime-canary/page.md",
						source: "runtime-canary",
						source_path: RUNTIME_CANARY_KNOWLEDGE_SOURCE_PATH,
						source_hash: knowledgeSourceHash,
						tags: ["runtime-canary"],
						title: "Runtime Canary Knowledge",
						summary: "Knowledge processing through the real Desktop process.",
						body: "# Runtime Canary Knowledge\n\nProcessed by the selected Knowledge session.",
					}),
				);
			} else if (serializedLatestInput.includes(RUNTIME_CANARY_QUESTION_PROMPT)) {
				writeEvents(response, questionResponseEvents());
			} else if (serializedLatestInput.includes(RUNTIME_CANARY_MCP_RESULT)) {
				writeEvents(response, textResponseEvents("DESKTOP_PROCESS_CANARY_MCP"));
			} else if (serializedLatestInput.includes(RUNTIME_CANARY_MCP_PROMPT)) {
				writeEvents(response, toolCallResponseEvents("mcp_runtime_canary_echo", { value: "restart" }));
			} else if (serializedLatestInput.includes(RUNTIME_CANARY_RESTART_PROMPT)) {
				writeEvents(response, textResponseEvents("DESKTOP_PROCESS_CANARY_RESTARTED"));
			} else if (serializedLatestInput.includes(RUNTIME_CANARY_SECOND_PROMPT)) {
				writeEvents(response, textResponseEvents("DESKTOP_PROCESS_CANARY_SECOND"));
			} else if (serializedLatestInput.includes(RUNTIME_CANARY_FIRST_PROMPT)) {
				writeEvents(response, textResponseEvents("DESKTOP_PROCESS_CANARY_FIRST"));
			} else {
				writeEvents(response, textResponseEvents("Desktop Process Canary"));
			}
		} catch (error) {
			if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
			response.end(error instanceof Error ? error.stack : String(error));
		}
	});

	await listen(server);
	const address = server.address();
	if (!address || typeof address === "string") {
		await closeServer(server);
		throw new Error("Expected Runtime Canary Provider TCP address");
	}
	const fixture: RuntimeCanaryFixture = {
		vettaHome,
		agentDir,
		workspace,
		providerBaseUrl: `http://127.0.0.1:${address.port}`,
		requestLogPath,
		installedCliPath,
		modelKey: RUNTIME_CANARY_MODEL_KEY,
		batchSourceDirectories,
		knowledgeRoot,
		knowledgeSourceHash,
	};
	try {
		await Promise.all([writeFixtureConfiguration(fixture), writeRuntimeCapabilities(fixture)]);
	} catch (error) {
		await closeServer(server);
		throw error;
	}

	return {
		fixture,
		async close() {
			server.closeAllConnections?.();
			await closeServer(server);
		},
	};
}

async function writeRuntimeCapabilities(fixture: RuntimeCanaryFixture): Promise<void> {
	const rootDir = dirname(fixture.vettaHome);
	const skillDir = join(fixture.agentDir, "skills", "runtime-canary");
	const mcpServerPath = join(rootDir, "runtime-canary-mcp.mjs");
	await mkdir(skillDir, { recursive: true });
	await Promise.all([
		writeFile(
			join(skillDir, "SKILL.md"),
			[
				"---",
				"name: runtime-canary",
				`description: ${RUNTIME_CANARY_SKILL_MARKER}`,
				"---",
				"",
				"# Runtime Canary",
				"",
				`Preserve this host skill marker: ${RUNTIME_CANARY_SKILL_MARKER}.`,
				"",
			].join("\n"),
		),
		writeFile(
			mcpServerPath,
			[
				'import { createInterface } from "node:readline";',
				"",
				"const lines = createInterface({ input: process.stdin });",
				"for await (const line of lines) {",
				"\tconst request = JSON.parse(line);",
				'\tif (!Object.hasOwn(request, "id")) continue;',
				"\tlet result;",
				'\tif (request.method === "initialize") {',
				"\t\tresult = {",
				'\t\t\tprotocolVersion: request.params?.protocolVersion ?? "2024-11-05",',
				"\t\t\tcapabilities: { tools: {} },",
				'\t\t\tserverInfo: { name: "runtime-canary", version: "1.0.0" },',
				"\t\t};",
				'\t} else if (request.method === "tools/list") {',
				"\t\tresult = {",
				"\t\t\ttools: [{",
				'\t\t\t\tname: "echo",',
				'\t\t\t\tdescription: "Desktop Runtime Canary MCP echo tool",',
				"\t\t\t\tinputSchema: {",
				'\t\t\t\t\ttype: "object",',
				'\t\t\t\t\tproperties: { value: { type: "string" } },',
				'\t\t\t\t\trequired: ["value"],',
				"\t\t\t\t\tadditionalProperties: false,",
				"\t\t\t\t},",
				"\t\t\t}],",
				"\t\t};",
				'\t} else if (request.method === "tools/call") {',
				'\t\tconst value = typeof request.params?.arguments?.value === "string" ? request.params.arguments.value : "";',
				`\t\tresult = { content: [{ type: "text", text: ${JSON.stringify("RUNTIME_CANARY_MCP_RESULT:")} + value }] };`,
				"\t} else {",
				"\t\tresult = {};",
				"\t}",
				'\tprocess.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");',
				"}",
				"",
			].join("\n"),
		),
	]);
	await writeFile(
		join(fixture.agentDir, "mcp.json"),
		JSON.stringify({
			mcpServers: {
				runtime_canary: {
					args: [mcpServerPath],
					command: process.execPath,
					startupTimeout: 10_000,
				},
			},
		}),
	);
}

async function writeFixtureConfiguration(fixture: RuntimeCanaryFixture): Promise<void> {
	await Promise.all([
		writeFile(
			join(fixture.agentDir, "models.json"),
			JSON.stringify(
				{
					providers: {
						[RUNTIME_CANARY_MODEL_PROVIDER]: {
							baseUrl: fixture.providerBaseUrl,
							api: "openai-responses",
							apiKey: "runtime-canary-key",
							models: [
								{
									id: RUNTIME_CANARY_MODEL_ID,
									name: "Desktop Process Canary Model",
									reasoning: false,
									input: ["text"],
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
									contextWindow: 8_000,
									maxTokens: 1_000,
								},
							],
						},
					},
				},
				null,
				2,
			),
		),
		writeFile(
			join(fixture.agentDir, "auth.json"),
			JSON.stringify({
				[RUNTIME_CANARY_MODEL_PROVIDER]: { type: "api_key", key: "runtime-canary-key" },
			}),
		),
		writeFile(
			join(fixture.vettaHome, "desktop-config.json"),
			JSON.stringify(
				{
					projects: [{ path: fixture.workspace, name: "Runtime Canary" }],
					archivedProjects: [],
					workspacePath: fixture.workspace,
					defaultExecutionMode: "full-access",
					defaultAgentMode: "coding",
					experimental: { vettaCli: false, promptPrediction: false, agentSkills: false },
					knowledgeBase: {
						enabled: true,
						pollIntervalMinutes: 0,
						processingModelKey: RUNTIME_CANARY_MODEL_KEY,
						processingModelReasoningLevel: "medium",
						agentConcurrency: 1,
						ocrConcurrency: 1,
					},
					shortcuts: { bindings: {} },
					quickPanel: { trigger: "none", postSendBehavior: "foreground" },
					appshot: { enabled: false, gesture: "both-shift" },
				},
				null,
				2,
			),
		),
	]);
}

function textResponseEvents(text: string): readonly unknown[] {
	const item = {
		type: "message",
		id: "msg_runtime_canary",
		status: "completed",
		role: "assistant",
		content: [{ type: "output_text", text, annotations: [] }],
	};
	return [
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { ...item, status: "in_progress", content: [] },
		},
		{
			type: "response.content_part.added",
			item_id: item.id,
			output_index: 0,
			content_index: 0,
			part: { type: "output_text", text: "", annotations: [] },
		},
		{ type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: text },
		{ type: "response.output_item.done", output_index: 0, item },
		completedResponse("resp_runtime_canary"),
	];
}

function questionResponseEvents(): readonly unknown[] {
	const argumentsJson = JSON.stringify({
		description: "Verify the Desktop question and abort lifecycle.",
		questions: [
			{
				question: RUNTIME_CANARY_QUESTION,
				header: "Canary",
				options: [
					{ label: "Continue", description: "Continue the canary." },
					{ label: "Stop", description: "Stop the canary." },
				],
			},
		],
	});
	const item = {
		type: "function_call",
		id: "fc_runtime_canary_question",
		call_id: "call_runtime_canary_question",
		name: "ask_user_question",
		arguments: argumentsJson,
		status: "completed",
	};
	return [
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { ...item, status: "in_progress", arguments: "" },
		},
		{
			type: "response.function_call_arguments.delta",
			item_id: item.id,
			output_index: 0,
			delta: argumentsJson,
		},
		{
			type: "response.function_call_arguments.done",
			item_id: item.id,
			output_index: 0,
			arguments: argumentsJson,
		},
		{ type: "response.output_item.done", output_index: 0, item },
		completedResponse("resp_runtime_canary_question"),
	];
}

function toolCallResponseEvents(name: string, argumentsValue: Readonly<Record<string, unknown>>): readonly unknown[] {
	const argumentsJson = JSON.stringify(argumentsValue);
	const item = {
		type: "function_call",
		id: "fc_runtime_canary_mcp",
		call_id: "call_runtime_canary_mcp",
		name,
		arguments: argumentsJson,
		status: "completed",
	};
	return [
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { ...item, status: "in_progress", arguments: "" },
		},
		{
			type: "response.function_call_arguments.delta",
			item_id: item.id,
			output_index: 0,
			delta: argumentsJson,
		},
		{
			type: "response.function_call_arguments.done",
			item_id: item.id,
			output_index: 0,
			arguments: argumentsJson,
		},
		{ type: "response.output_item.done", output_index: 0, item },
		completedResponse("resp_runtime_canary_mcp"),
	];
}

function completedResponse(responseId: string): unknown {
	return {
		type: "response.completed",
		response: {
			id: responseId,
			object: "response",
			status: "completed",
			output: [],
			usage: {
				input_tokens: 10,
				input_tokens_details: { cached_tokens: 0 },
				output_tokens: 5,
				output_tokens_details: { reasoning_tokens: 0 },
				total_tokens: 15,
			},
		},
	};
}

function writeEvents(response: ServerResponse, events: readonly unknown[]): void {
	response.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	for (const event of events) response.write(`data: ${JSON.stringify(event)}\n\n`);
	response.end("data: [DONE]\n\n");
}

function writePendingResponse(response: ServerResponse): void {
	response.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	response.write(": runtime canary pending\n\n");
}

async function readBody(request: NodeJS.ReadableStream): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8");
}

async function listen(server: Server): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
}

async function closeServer(server: Server): Promise<void> {
	if (!server.listening) return;
	await new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}
