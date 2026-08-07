import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CodingAgentHostBootstrap, createCodingAgentHostBootstrap } from "@vetta/coding-agent/bootstrap";
import type { RpcSessionInitialization } from "@vetta/coding-agent/rpc";
import type { RuntimeSessionCatalog } from "@vetta/runtime-core";
import { CONVERSATION_STORAGE_ERROR_CODES } from "@vetta/runtime-storage/conversation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCliRuntimeSessionCatalog } from "../src/rpc/cli-session-format-compatibility.js";
import { prepareImRuntimeHost, type RpcRuntimeHostReady } from "../src/rpc/runtime-host/runtime-host.js";

const temporaryDirectories: string[] = [];
const preparedHosts: RpcRuntimeHostReady[] = [];

afterEach(async () => {
	for (const prepared of preparedHosts.splice(0).reverse()) await prepared.capabilities.dispose();
	for (const directory of temporaryDirectories.splice(0).reverse()) {
		await rm(directory, { force: true, recursive: true });
	}
	delete extensionLifecycleGlobal().__vettaGreenfieldExtensionLifecycle;
});

describe("IM Runtime Host", () => {
	it("migrates a representable Legacy session without changing its source", async () => {
		const fixture = await createFixture([]);
		const legacyPath = join(fixture.conversationDir, "legacy.jsonl");
		const legacyContent = `${JSON.stringify({
			type: "session",
			version: 3,
			id: "legacy-source",
			timestamp: "2026-01-01T00:00:00.000Z",
			cwd: fixture.workspace,
		})}\n${JSON.stringify({
			type: "message",
			id: "legacy-user",
			parentId: null,
			timestamp: "2026-01-01T00:00:01.000Z",
			message: { role: "user", content: "legacy", timestamp: 1 },
		})}\n`;
		await mkdir(fixture.conversationDir, { recursive: true });
		await writeFile(legacyPath, legacyContent, "utf8");
		const bootstrap = await createBootstrap(fixture, ["--session", legacyPath]);

		const result = await prepareImRuntimeHost({
			bootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
		});

		expect(result).toMatchObject({ kind: "greenfield" });
		if (result.kind !== "greenfield") throw new Error("Expected Greenfield runtime");
		preparedHosts.push(result);
		expect(result.session.sessionId).toMatch(/^legacy-import-/);
		expect(await readFile(legacyPath, "utf8")).toBe(legacyContent);
	});

	it("owns fresh and resumed conversations for the whole runtime lifetime", async () => {
		const fixture = await createFixture([]);
		const fresh = await prepareImRuntimeHost({
			bootstrap: fixture.bootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
			createSessionId: () => "im-session",
		});
		expect(fresh.kind).toBe("greenfield");
		if (fresh.kind !== "greenfield") throw new Error("Expected Greenfield runtime");
		preparedHosts.push(fresh);
		const sessionPath = fresh.session.createCoreAssembly().lifecycle.sessionPath;
		if (!sessionPath) throw new Error("Expected persisted Greenfield session path");
		const ownerPath = `${sessionPath}.owner.lock`;
		await expect(stat(ownerPath)).resolves.toBeDefined();

		const conflictingBootstrap = await createBootstrap(fixture, ["--session", sessionPath]);
		await expect(
			prepareImRuntimeHost({
				bootstrap: conflictingBootstrap,
				conversationDir: fixture.conversationDir,
				sessionCatalog: fixture.sessionCatalog,
			}),
		).rejects.toMatchObject({ code: CONVERSATION_STORAGE_ERROR_CODES.OWNERSHIP_CONFLICT });

		await fresh.capabilities.dispose();
		preparedHosts.splice(preparedHosts.indexOf(fresh), 1);
		await expect(stat(ownerPath)).rejects.toMatchObject({ code: "ENOENT" });

		const resumedBootstrap = await createBootstrap(fixture, ["--session", sessionPath]);
		const resumed = await prepareImRuntimeHost({
			bootstrap: resumedBootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
		});
		expect(resumed.kind).toBe("greenfield");
		if (resumed.kind !== "greenfield") throw new Error("Expected resumed Greenfield runtime");
		preparedHosts.push(resumed);
		expect(resumed.session.sessionId).toBe("im-session");
	});

	it("transitions new and resumed sessions through the production RPC capability", async () => {
		const fixture = await createFixture([]);
		const sessionIds = ["transition-initial", "transition-next"];
		const result = await prepareImRuntimeHost({
			bootstrap: fixture.bootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
			createSessionId: () => sessionIds.shift() ?? "unexpected-session",
		});
		expect(result.kind).toBe("greenfield");
		if (result.kind !== "greenfield") throw new Error("Expected Greenfield runtime");
		preparedHosts.push(result);
		const sessionCapability = result.capabilities.session;
		if (!sessionCapability) throw new Error("Expected Greenfield session capability");

		const initialPath = result.session.createCoreAssembly().lifecycle.sessionPath;
		if (!initialPath) throw new Error("Expected initial session path");
		const initialOwnerPath = `${initialPath}.owner.lock`;
		await expect(stat(initialOwnerPath)).resolves.toBeDefined();

		await expect(sessionCapability.newSession(initialPath)).resolves.toBe(true);
		expect(result.session.sessionId).toBe("transition-next");
		const nextPath = result.session.createCoreAssembly().lifecycle.sessionPath;
		if (!nextPath) throw new Error("Expected next session path");
		const nextOwnerPath = `${nextPath}.owner.lock`;
		await expect(stat(initialOwnerPath)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(stat(nextOwnerPath)).resolves.toBeDefined();

		await expect(sessionCapability.switchSession(initialPath)).resolves.toBe(true);
		expect(result.session.sessionId).toBe("transition-initial");
		await expect(stat(initialOwnerPath)).resolves.toBeDefined();
		await expect(stat(nextOwnerPath)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("rejects malformed Runtime paths instead of treating them as historical sessions", async () => {
		const fixture = await createFixture(["--session", join("outside", "bad.conversation.jsonl")]);

		await expect(
			prepareImRuntimeHost({
				bootstrap: fixture.bootstrap,
				conversationDir: fixture.conversationDir,
				sessionCatalog: fixture.sessionCatalog,
			}),
		).rejects.toThrow("Invalid Runtime conversation path");
	});

	it("rejects the removed interactive resume selection", async () => {
		const fixture = await createFixture(["--resume"]);

		await expect(
			prepareImRuntimeHost({
				bootstrap: fixture.bootstrap,
				conversationDir: fixture.conversationDir,
				sessionCatalog: fixture.sessionCatalog,
			}),
		).rejects.toThrow("--resume is no longer supported; use --continue or --session");
	});

	it("runs Flag and Command Extensions after resolving their Runtime capabilities", async () => {
		const lifecycle = extensionLifecycleGlobal();
		lifecycle.__vettaGreenfieldExtensionLifecycle = [];
		const fixture = await createFixture(
			[],
			`
				export default function(pi) {
					pi.registerFlag("audit-mode", { type: "boolean" });
					pi.registerCommand("audit", {
						handler: async () => globalThis.__vettaGreenfieldExtensionLifecycle.push("audit"),
					});
				}
			`,
		);
		expect(fixture.bootstrap.extensionsResult.extensions).toHaveLength(1);
		expect(fixture.bootstrap.extensionRequirements).toMatchObject({
			bootstrapContributions: { flags: ["audit-mode"] },
			requiredRuntimeCapabilities: ["opaque-runtime-api", "command"],
		});

		const result = await prepareImRuntimeHost({
			bootstrap: fixture.bootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
			createSessionId: () => "command-extension-session",
		});
		expect(result.kind).toBe("greenfield");
		if (result.kind !== "greenfield") throw new Error("Expected Greenfield runtime");
		preparedHosts.push(result);
		await initialize(result);

		await result.capabilities.turn?.prompt("/audit", { source: "rpc" });

		expect(lifecycle.__vettaGreenfieldExtensionLifecycle).toEqual(["audit"]);
	});

	it("runs Provider/Flag-only Extensions on the production Runtime and binds their retained actions", async () => {
		const fixture = await createFixture(
			[],
			`
				export default function(pi) {
					pi.registerFlag("endpoint", { type: "string" });
					pi.registerProvider("fixture-provider", {
						baseUrl: "https://fixture.test",
						api: "openai-responses",
						models: [],
					});
				}
			`,
		);

		const result = await prepareImRuntimeHost({
			bootstrap: fixture.bootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
			createSessionId: () => "extension-session",
		});
		expect(result.kind).toBe("greenfield");
		if (result.kind !== "greenfield") throw new Error("Expected Greenfield runtime");
		preparedHosts.push(result);

		fixture.bootstrap.extensionsResult.runtime.setSessionName("Extension Session");
		await result.capabilities.dispose();
		preparedHosts.splice(preparedHosts.indexOf(result), 1);

		expect(() => result.session).toThrow("active session host is disposed");
	});

	it("runs Tool-only Extensions on the production Runtime without closing unrelated compatibility gaps", async () => {
		const fixture = await createFixture(
			[],
			`
				export default function(pi) {
					pi.registerTool({
						name: "extension_echo",
						label: "Extension Echo",
						description: "Echo a value.",
						parameters: {
							type: "object",
							properties: { value: { type: "string" } },
							required: ["value"],
						},
						async execute(_id, params) {
							return { content: [{ type: "text", text: params.value }], details: {} };
						},
					});
				}
			`,
		);
		expect(fixture.bootstrap.extensionRequirements).toMatchObject({
			requiredRuntimeCapabilities: ["opaque-runtime-api", "tool"],
		});

		const result = await prepareImRuntimeHost({
			bootstrap: fixture.bootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
			createSessionId: () => "extension-tool-session",
		});
		expect(result.kind).toBe("greenfield");
		if (result.kind !== "greenfield") throw new Error("Expected Greenfield runtime");
		preparedHosts.push(result);

		expect(result.session.createCoreAssembly().corePorts.stateReader.readState()).toMatchObject({
			activeToolNames: expect.arrayContaining(["extension_echo"]),
		});
	});

	it("treats RPC-only UI registrations and user_bash as host-inapplicable", async () => {
		const fixture = await createFixture(
			[],
			`export default function(pi) {
				pi.registerShortcut("ctrl+shift+r", { handler: async () => {} });
				pi.registerMessageRenderer("audit-card", () => null);
				pi.on("user_bash", async () => ({ result: undefined }));
			}`,
		);

		const result = await prepareImRuntimeHost({
			bootstrap: fixture.bootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
			createSessionId: () => "inapplicable-extension-session",
		});

		expect(result.kind).toBe("greenfield");
		if (result.kind !== "greenfield") throw new Error("Expected Greenfield runtime");
		preparedHosts.push(result);
	});

	it("reports an unknown Extension event as a neutral incompatibility fact", async () => {
		const fixture = await createFixture(
			[],
			`export default function(pi) {
				pi.on("future_event", async () => {});
			}`,
		);

		const result = await prepareImRuntimeHost({
			bootstrap: fixture.bootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
		});

		expect(result).toMatchObject({
			kind: "extension-incompatible",
			sessionPath: undefined,
			extensionCompatibility: {
				compatible: false,
				unsupportedEvents: ["future_event"],
				unmetRuntimeCapabilities: ["event-handler"],
			},
		});
		expect("reason" in result).toBe(false);
	});

	it("applies resources_discover contributions during Extension startup", async () => {
		const fixture = await createFixture(
			[],
			`import { join } from "node:path";
			export default function(pi) {
				pi.on("resources_discover", async (event) => ({
					promptPaths: [join(event.cwd, "extension-prompt.md")],
				}));
			}`,
		);
		await writeFile(join(fixture.workspace, "extension-prompt.md"), "Discovered prompt", "utf8");
		const result = await prepareImRuntimeHost({
			bootstrap: fixture.bootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
			createSessionId: () => "resource-extension-session",
		});
		expect(result.kind).toBe("greenfield");
		if (result.kind !== "greenfield") throw new Error("Expected Greenfield runtime");
		preparedHosts.push(result);
		await initialize(result);

		expect(result.capabilities.commands?.readCommands()).toContainEqual(
			expect.objectContaining({ name: "extension-prompt", source: "prompt" }),
		);
	});

	it("emits model_select when an Extension changes the Runtime model", async () => {
		const lifecycle = extensionLifecycleGlobal();
		lifecycle.__vettaGreenfieldExtensionLifecycle = [];
		const fixture = await createFixture(
			[],
			`const nextModel = {
				id: "second-model",
				name: "Second Model",
				api: "openai-responses",
				provider: "test",
				baseUrl: "https://example.test",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 8000,
				maxTokens: 1000,
			};
			export default function(pi) {
				pi.on("model_select", async (event) => {
					globalThis.__vettaGreenfieldExtensionLifecycle.push(
						(event.previousModel?.id ?? "none") + "->" + event.model.id + ":" + event.source,
					);
				});
				pi.registerCommand("switch-model", {
					handler: async () => {
						if (!(await pi.setModel(nextModel))) throw new Error("model selection failed");
					},
				});
			}`,
		);
		const result = await prepareImRuntimeHost({
			bootstrap: fixture.bootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
			createSessionId: () => "model-select-extension-session",
		});
		expect(result.kind).toBe("greenfield");
		if (result.kind !== "greenfield") throw new Error("Expected Greenfield runtime");
		preparedHosts.push(result);
		await initialize(result);

		await result.capabilities.turn?.prompt("/switch-model", { source: "rpc" });

		expect(result.session.readState().model?.id).toBe("second-model");
		expect(lifecycle.__vettaGreenfieldExtensionLifecycle).toEqual(["test-model->second-model:set"]);
	});

	it("routes manual compaction through the active Extension runner", async () => {
		const lifecycle = extensionLifecycleGlobal();
		lifecycle.__vettaGreenfieldExtensionLifecycle = [];
		const fixture = await createFixture(
			[],
			`export default function(pi) {
				pi.on("session_before_compact", async () => {
					globalThis.__vettaGreenfieldExtensionLifecycle.push("before-compact");
					return { cancel: true };
				});
			}`,
		);
		const result = await prepareImRuntimeHost({
			bootstrap: fixture.bootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
			createSessionId: () => "compaction-extension-session",
		});
		expect(result.kind).toBe("greenfield");
		if (result.kind !== "greenfield") throw new Error("Expected Greenfield runtime");
		preparedHosts.push(result);
		await initialize(result);
		const assembly = result.session.createCoreAssembly();
		await assembly.metadataController.appendEntry("compaction-seed", { value: "seed" });
		const contextController = assembly.contextController;
		if (!contextController) throw new Error("Expected Greenfield context controller");

		await expect(contextController.compact()).rejects.toThrow("Compaction cancelled");
		expect(lifecycle.__vettaGreenfieldExtensionLifecycle).toEqual(["before-compact"]);
	});

	it("exposes both resource and Extension command discovery", async () => {
		const fixture = await createFixture([]);
		const result = await prepareImRuntimeHost({
			bootstrap: fixture.bootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
			createSessionId: () => "command-discovery-session",
		});
		expect(result.kind).toBe("greenfield");
		if (result.kind !== "greenfield") throw new Error("Expected Greenfield runtime");
		preparedHosts.push(result);

		expect(result.capabilities.profile.commands).toContain("get_commands");
		const commands = result.capabilities.commands?.readCommands() ?? [];
		expect(commands.length).toBeGreaterThan(0);
		expect(commands.every(({ source }) => source === "prompt" || source === "skill")).toBe(true);

		const commandFixture = await createFixture(
			[],
			`export default function(pi) {
				pi.registerCommand("audit", { handler: async () => {} });
			}`,
		);
		const commandResult = await prepareImRuntimeHost({
			bootstrap: commandFixture.bootstrap,
			conversationDir: commandFixture.conversationDir,
			sessionCatalog: commandFixture.sessionCatalog,
			createSessionId: () => "extension-command-discovery-session",
		});
		expect(commandResult.kind).toBe("greenfield");
		if (commandResult.kind !== "greenfield") throw new Error("Expected Greenfield runtime");
		preparedHosts.push(commandResult);
		expect(commandResult.capabilities.commands?.readCommands()).toContainEqual(
			expect.objectContaining({ name: "audit", source: "extension" }),
		);
	});

	it("atomically reloads Extension events, commands and definitions", async () => {
		const lifecycle = extensionLifecycleGlobal();
		lifecycle.__vettaGreenfieldExtensionLifecycle = [];
		const fixture = await createFixture(
			[],
			`export default function(pi) {
				pi.on("session_shutdown", async () => {
					globalThis.__vettaGreenfieldExtensionLifecycle.push("old-shutdown");
				});
				pi.registerCommand("reload-fixture", { handler: async (_args, ctx) => ctx.reload() });
			}`,
		);
		const result = await prepareImRuntimeHost({
			bootstrap: fixture.bootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
			createSessionId: () => "extension-reload-session",
		});
		expect(result.kind).toBe("greenfield");
		if (result.kind !== "greenfield") throw new Error("Expected Greenfield runtime");
		preparedHosts.push(result);
		await initialize(result);
		await writeFile(join(fixture.workspace, "reloaded-prompt.md"), "Reloaded prompt", "utf8");
		await writeFile(
			join(fixture.root, "legacy-extension.ts"),
			`export default function(pi) {
				pi.on("session_start", async () => {
					globalThis.__vettaGreenfieldExtensionLifecycle.push("new-start");
				});
				pi.registerCommand("after-reload", {
					handler: async () => globalThis.__vettaGreenfieldExtensionLifecycle.push("after-command"),
				});
				pi.on("resources_discover", async (event) => {
					if (event.reason !== "reload") throw new Error("unexpected discovery reason");
					return { promptPaths: [event.cwd + "/reloaded-prompt.md"] };
				});
			}`,
			"utf8",
		);

		await result.capabilities.turn?.prompt("/reload-fixture", { source: "rpc" });
		expect(result.capabilities.commands?.readCommands()).toContainEqual(
			expect.objectContaining({ name: "after-reload", source: "extension" }),
		);
		expect(result.capabilities.commands?.readCommands()).not.toContainEqual(
			expect.objectContaining({ name: "reload-fixture" }),
		);
		expect(result.capabilities.commands?.readCommands()).toContainEqual(
			expect.objectContaining({ name: "reloaded-prompt", source: "prompt" }),
		);
		await result.capabilities.turn?.prompt("/after-reload", { source: "rpc" });

		expect(lifecycle.__vettaGreenfieldExtensionLifecycle).toEqual(["old-shutdown", "new-start", "after-command"]);
	});

	it("runs supported input events with a real Runtime session context", async () => {
		const fixture = await createFixture(
			[],
			`
				export default function(pi) {
					pi.on("input", async (event, ctx) => {
						if (event.source !== "rpc") throw new Error("unexpected input source");
						if (ctx.sessionManager.getSessionId() !== "extension-event-session") {
							throw new Error("unexpected session id");
						}
						if (ctx.model?.id !== "test-model") throw new Error("unexpected model");
						if (!ctx.isIdle() || ctx.hasPendingMessages()) throw new Error("unexpected queue state");
						if (ctx.getContextUsage()?.contextWindow !== 8000) throw new Error("unexpected context usage");
						if (ctx.sessionManager.getHeader()?.id !== "extension-event-session") {
							throw new Error("unexpected session header");
						}
						if (ctx.sessionManager.getEntries().length !== 0 || ctx.sessionManager.getTree().length !== 0) {
							throw new Error("unexpected initial conversation");
						}
						if (!ctx.getSystemPrompt()) throw new Error("system prompt was not initialized");
						return { action: "handled" };
					});
				}
			`,
		);

		const result = await prepareImRuntimeHost({
			bootstrap: fixture.bootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
			createSessionId: () => "extension-event-session",
		});
		expect(result.kind).toBe("greenfield");
		if (result.kind !== "greenfield") throw new Error("Expected Greenfield runtime");
		preparedHosts.push(result);

		await expect(result.session.prompt({ text: "handled by extension" })).resolves.toEqual({
			status: "handled",
			sessionId: "extension-event-session",
		});
		await expect(result.session.getMessages()).resolves.toEqual([]);
	});

	it("emits supported session lifecycle events exactly once through the real Runtime Host", async () => {
		const lifecycle = extensionLifecycleGlobal();
		lifecycle.__vettaGreenfieldExtensionLifecycle = [];
		const fixture = await createFixture(
			[],
			`
				export default function(pi) {
					pi.on("session_start", async () => {
						globalThis.__vettaGreenfieldExtensionLifecycle.push("start");
					});
					pi.on("session_shutdown", async () => {
						globalThis.__vettaGreenfieldExtensionLifecycle.push("shutdown");
					});
				}
			`,
		);

		const sessionIds = ["extension-lifecycle-session", "extension-lifecycle-next"];
		const result = await prepareImRuntimeHost({
			bootstrap: fixture.bootstrap,
			conversationDir: fixture.conversationDir,
			sessionCatalog: fixture.sessionCatalog,
			createSessionId: () => sessionIds.shift() ?? "unexpected-session",
		});
		expect(result.kind).toBe("greenfield");
		if (result.kind !== "greenfield") throw new Error("Expected Greenfield runtime");
		preparedHosts.push(result);

		expect(lifecycle.__vettaGreenfieldExtensionLifecycle).toEqual([]);
		await result.capabilities.initialize({
			uiContext: {} as RpcSessionInitialization["uiContext"],
			hostBridge: { sendAttachment: vi.fn(async () => ({})) },
			onShutdownRequested: vi.fn(),
			onExtensionError: vi.fn(),
		});
		const sessionCapability = result.capabilities.session;
		if (!sessionCapability) throw new Error("Expected Greenfield session capability");
		await expect(sessionCapability.newSession()).resolves.toBe(true);
		await result.capabilities.shutdown();
		await result.capabilities.shutdown();

		expect(lifecycle.__vettaGreenfieldExtensionLifecycle).toEqual(["start", "shutdown"]);
	});
});

function extensionLifecycleGlobal(): typeof globalThis & {
	__vettaGreenfieldExtensionLifecycle?: string[];
} {
	return globalThis;
}

async function initialize(result: RpcRuntimeHostReady): Promise<void> {
	await result.capabilities.initialize({
		uiContext: {} as RpcSessionInitialization["uiContext"],
		hostBridge: { sendAttachment: vi.fn(async () => ({})) },
		onShutdownRequested: vi.fn(),
		onExtensionError: vi.fn(),
	});
}

async function createFixture(
	extraArgs: string[],
	extensionSource?: string,
): Promise<{
	readonly root: string;
	readonly agentDir: string;
	readonly workspace: string;
	readonly conversationDir: string;
	readonly sessionCatalog: RuntimeSessionCatalog;
	readonly bootstrap: CodingAgentHostBootstrap;
}> {
	const root = await mkdtemp(join(tmpdir(), "vetta-im-runtime-host-"));
	temporaryDirectories.push(root);
	const fixture = {
		root,
		agentDir: join(root, "agent"),
		workspace: join(root, "workspace"),
		conversationDir: join(root, "conversations"),
	};
	await Promise.all([mkdir(fixture.workspace, { recursive: true }), mkdir(fixture.agentDir, { recursive: true })]);
	await writeFile(
		join(fixture.agentDir, "models.json"),
		JSON.stringify({
			providers: {
				test: {
					baseUrl: "https://example.test",
					api: "openai-responses",
					models: [
						{
							id: "test-model",
							name: "Test Model",
							reasoning: true,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 8_000,
							maxTokens: 1_000,
						},
						{
							id: "second-model",
							name: "Second Model",
							reasoning: true,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 8_000,
							maxTokens: 1_000,
						},
					],
				},
			},
		}),
		"utf8",
	);
	const extensionPath = join(root, "legacy-extension.ts");
	if (extensionSource) await writeFile(extensionPath, extensionSource, "utf8");
	const bootstrap = await createBootstrap(
		fixture,
		extensionSource ? [...extraArgs, "--extension", extensionPath] : extraArgs,
	);
	const sessionCatalog = createCliRuntimeSessionCatalog({
		cwd: fixture.workspace,
		sessionDir: fixture.conversationDir,
	});
	return { ...fixture, sessionCatalog, bootstrap };
}

async function createBootstrap(
	fixture: { readonly agentDir: string; readonly workspace: string },
	extraArgs: string[],
): Promise<CodingAgentHostBootstrap> {
	const bootstrap = await createCodingAgentHostBootstrap({
		args: ["--mode", "rpc", "--enable-host-bridge", "--scenario", "im-claw", ...extraArgs],
		cwd: fixture.workspace,
		agentDir: fixture.agentDir,
	});
	const model = bootstrap.modelRegistry.getAll()[0];
	if (!model) throw new Error("Expected at least one built-in model");
	bootstrap.authStorage.setRuntimeApiKey(model.provider, "test-key");
	bootstrap.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
	return bootstrap;
}
