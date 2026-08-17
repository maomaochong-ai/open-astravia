import { describe, expect, it } from "vitest";
import {
	collectCodingAgentArchitectureState,
	findCodingAgentArchitectureViolations,
} from "./check-coding-agent-architecture.mjs";

const SOURCE_ROOT = "packages/coding-agent/src";

function createState(extraFiles = [], overrides = {}) {
	return collectCodingAgentArchitectureState({
		files: [
			{
				path: `${SOURCE_ROOT}/index.ts`,
				text: 'export * from "./public-api/extensions.js";',
			},
			{
				path: `${SOURCE_ROOT}/composition/index.ts`,
				text: 'export type { CodingAgentRuntimeComposition } from "./contracts/index.js";',
			},
			...extraFiles,
		],
		packageJson: {
			exports: { ".": "./dist/index.js", "./composition": "./dist/composition/index.js" },
			...overrides,
		},
	});
}

describe("Coding Agent architecture gate", () => {
	it("accepts the current dependency direction and declared public surface", () => {
		const state = createState([
			{
				path: `${SOURCE_ROOT}/composition/contracts/sample.ts`,
				text: 'import type { RuntimeSession } from "@vetta/runtime-core";',
			},
			{
				path: `${SOURCE_ROOT}/memory/runtime.ts`,
				text: 'import type { CodingAgentRuntimeModelSource } from "../runtime-contracts/index.js";',
			},
			{
				path: `${SOURCE_ROOT}/composition/runtime.ts`,
				text: 'import { createAdapter } from "../adapters/runtime-core/adapter.js";',
			},
			{
				path: `${SOURCE_ROOT}/adapters/runtime-core/adapter.ts`,
				text: 'import type { RuntimeOptions } from "../../composition/contracts/index.js";',
			},
			{
				path: "packages/cli-app/src/runtime.ts",
				text: 'import { createCodingAgentRuntimeComposition } from "@vetta/coding-agent/composition";',
			},
		]);

		expect(findCodingAgentArchitectureViolations(state)).toEqual([]);
	});

	it.each([
		[
			"contract to implementation",
			`${SOURCE_ROOT}/composition/contracts/sample.ts`,
			'import type { Value } from "../../adapters/runtime-core/adapter.js";',
			"contract depends on implementation",
		],
		[
			"domain to composition",
			`${SOURCE_ROOT}/memory/runtime.ts`,
			'import { createRuntime } from "../composition/runtime-composition.js";',
			"Coding Agent domain depends on orchestration or implementation",
		],
		[
			"adapter to Composition implementation",
			`${SOURCE_ROOT}/adapters/runtime-core/adapter.ts`,
			'import { createRuntime } from "../../composition/runtime-composition.js";',
			"Adapter depends on Composition or a public facade",
		],
		[
			"historical format to host execution",
			`${SOURCE_ROOT}/sessions/legacy/reader.ts`,
			'import { execute } from "../../host/session-execution/executor.js";',
			"historical format boundary depends on Agent execution",
		],
		[
			"consumer deep import",
			"packages/cli-app/src/runtime.ts",
			'import { value } from "@vetta/coding-agent/src/private.js";',
			"consumer uses a non-public Coding Agent subpath",
		],
	])("rejects %s", (_name, path, text, expected) => {
		const violations = findCodingAgentArchitectureViolations(createState([{ path, text }]));

		expect(violations.some((violation) => violation.includes(expected))).toBe(true);
	});

	it("rejects retired implementation directories while allowing format-owned storage modules", () => {
		const state = createState([
			{ path: `${SOURCE_ROOT}/core/agent.ts`, text: "export const value = 1;" },
			{
				path: `${SOURCE_ROOT}/sessions/legacy/storage/atomic-writer.ts`,
				text: 'import { writeFile } from "node:fs/promises";',
			},
		]);
		const violations = findCodingAgentArchitectureViolations(state);

		expect(violations.some((violation) => violation.includes("retired implementation directory"))).toBe(true);
		expect(violations.some((violation) => violation.includes("historical file mutation"))).toBe(false);
	});

	it("keeps contract adapters independent from Node platform implementations", () => {
		const nodePathAdapter = createState([
			{
				path: `${SOURCE_ROOT}/adapters/extensions/session-view-adapter.ts`,
				text: 'import { dirname } from "node:path";',
			},
		]);
		const runtimeNodeAdapter = createState([
			{
				path: `${SOURCE_ROOT}/adapters/runtime-core/model-adapter.ts`,
				text: 'import { createHost } from "@vetta/runtime-node/host";',
			},
		]);

		expect(findCodingAgentArchitectureViolations(nodePathAdapter)).toContain(
			`${SOURCE_ROOT}/adapters/extensions/session-view-adapter.ts:1: Adapter must consume platform-neutral facts, not a Node implementation`,
		);
		expect(findCodingAgentArchitectureViolations(runtimeNodeAdapter)).toContain(
			`${SOURCE_ROOT}/adapters/runtime-core/model-adapter.ts:1: Adapter must consume platform-neutral facts, not a Node implementation`,
		);
	});

	it("keeps historical conversion in its explicit format adapter", () => {
		const allowed = createState([
			{
				path: `${SOURCE_ROOT}/sessions/legacy/converters/v2.ts`,
				text: 'import { migrateLegacySessionToV2 } from "@vetta/runtime-storage/conversation";',
			},
		]);
		const rejected = createState([
			{
				path: `${SOURCE_ROOT}/sessions/setup/migration.ts`,
				text: 'import { migrateLegacySessionToV2 } from "@vetta/runtime-storage/conversation";',
			},
		]);

		expect(findCodingAgentArchitectureViolations(allowed)).toEqual([]);
		expect(
			findCodingAgentArchitectureViolations(rejected).some((violation) =>
				violation.includes("historical conversion is outside its owner"),
			),
		).toBe(true);
	});

	it("allows manifest-declared package and root-level Composition extensions", () => {
		const state = createState(
			[
				{
					path: `${SOURCE_ROOT}/composition/index.ts`,
					text: 'export { createNewCapability } from "./new-capability.js";',
				},
				{
					path: "packages/cli-app/src/new-capability.ts",
					text: 'import { createNewCapability } from "@vetta/coding-agent/new-capability";',
				},
			],
			{ exports: { ".": "./dist/index.js", "./new-capability": "./dist/new-capability.js" } },
		);

		expect(findCodingAgentArchitectureViolations(state)).toEqual([]);
	});

	it("rejects Composition exports from internal implementation areas", () => {
		const state = createState([
			{
				path: `${SOURCE_ROOT}/composition/index.ts`,
				text: 'export { createInternalToolSurface } from "./tool-surface/runtime-tool-surface.js";',
			},
		]);

		expect(findCodingAgentArchitectureViolations(state)).toContain(
			`${SOURCE_ROOT}/composition/index.ts:1: Composition public entry exports an internal implementation (./tool-surface/runtime-tool-surface.js)`,
		);
	});

	it("supports manifest wildcard exports without allowing unrelated deep imports", () => {
		const state = createState(
			[
				{
					path: "packages/cli-app/src/plugins.ts",
					text: [
						'import { official } from "@vetta/coding-agent/plugins/official";',
						'import { privateValue } from "@vetta/coding-agent/private/value";',
					].join("\n"),
				},
			],
			{ exports: { ".": "./dist/index.js", "./plugins/*": "./dist/plugins/*.js" } },
		);
		const violations = findCodingAgentArchitectureViolations(state);

		expect(violations).toHaveLength(1);
		expect(violations[0]).toContain("@vetta/coding-agent/private/value");
	});

	it("uses syntax edges instead of matching imports in comments", () => {
		const state = createState([
			{
				path: `${SOURCE_ROOT}/memory/runtime.ts`,
				text: '// import { createRuntime } from "../composition/runtime-composition.js";',
			},
		]);

		expect(findCodingAgentArchitectureViolations(state)).toEqual([]);
	});

	it.each([
		"packages/cli-app/src/rpc/runtime-host/cli-session-assembly.ts",
		"packages/runtime-desktop/src/backend-pool.ts",
		"packages/desktop-app/src/main/knowledge/processing-session-factory.ts",
	])("requires %s to select and inject Node conversation persistence", (path) => {
		const requiresMemoryStorage = path === "packages/cli-app/src/rpc/runtime-host/cli-session-assembly.ts";
		const missing = createState([
			{
				path,
				text: 'import { createCodingAgentRuntimeComposition } from "@vetta/coding-agent/composition";',
			},
		]);
		const configured = createState([
			{
				path,
				text: [
					'import { createCodingAgentRuntimeComposition } from "@vetta/coding-agent/composition";',
					'import { createFileConversationPersistence } from "@vetta/runtime-node/conversation";',
					`import { createNodeKnowledgeRuntime${requiresMemoryStorage ? ", NodeTextFileStorage" : ""} } from "@vetta/runtime-node/host";`,
					"createCodingAgentRuntimeComposition({",
					"\tcreateConversationPersistence: () => createFileConversationPersistence(conversationDir),",
					"\tcreateToolEnvironment: hostToolEnvironmentFactory,",
					"\tcreateSessionExecutionEnvironment: hostSessionExecutionEnvironmentFactory,",
					"\tcodingToolResultPolicy: hostToolResultPolicy,",
					"\tknowledgeRuntime: createNodeKnowledgeRuntime(knowledgeDir),",
					...(requiresMemoryStorage
						? ["\tcreateMemoryRolloverRuntime: () => new NodeTextFileStorage(memoryFile),"]
						: []),
					"});",
				].join("\n"),
			},
		]);

		const expectedMissing = [
			`${path}: platform Composition Root must select createFileConversationPersistence from runtime-node`,
			`${path}: platform Composition Root must inject createConversationPersistence`,
			`${path}: host Composition Root must inject createToolEnvironment`,
			`${path}: host Composition Root must inject createSessionExecutionEnvironment`,
			`${path}: Node Host Composition Root must inject codingToolResultPolicy`,
		];
		if (path !== "packages/runtime-desktop/src/backend-pool.ts") {
			expectedMissing.push(`${path}: Node Host Composition Root must inject createNodeKnowledgeRuntime`);
		}
		if (requiresMemoryStorage) {
			expectedMissing.push(`${path}: Node Host Composition Root must inject NodeTextFileStorage for Memory`);
		}
		expect(findCodingAgentArchitectureViolations(missing)).toEqual(expectedMissing);
		expect(findCodingAgentArchitectureViolations(configured)).toEqual([]);
	});

	it("keeps concrete Conversation persistence outside the Coding Agent Composition", () => {
		const importingNode = createState([
			{
				path: `${SOURCE_ROOT}/composition/runtime-composition.ts`,
				text: [
					'import { createFileConversationPersistence } from "@vetta/runtime-node/conversation";',
					"options.createConversationPersistence({ conversationDir: options.conversationDir });",
				].join("\n"),
			},
		]);
		const missingPort = createState([
			{
				path: `${SOURCE_ROOT}/composition/runtime-composition.ts`,
				text: "export const runtime = {};",
			},
		]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${SOURCE_ROOT}/composition/runtime-composition.ts:1: Coding Agent Composition must consume a persistence Port, not a Node implementation`,
		);
		expect(findCodingAgentArchitectureViolations(missingPort)).toContain(
			`${SOURCE_ROOT}/composition/runtime-composition.ts: Coding Agent Composition must obtain conversation persistence from its host Port`,
		);
	});

	it("keeps Node tool creation behind the host ToolEnvironment Port", () => {
		const toolCompositionPath = `${SOURCE_ROOT}/composition/tool-surface/runtime-tools-composition.ts`;
		const runtimeCompositionPath = `${SOURCE_ROOT}/composition/runtime-composition.ts`;
		const importingNode = createState([
			{
				path: toolCompositionPath,
				text: 'import { createReadToolRegistration } from "@vetta/runtime-node/coding";',
			},
		]);
		const missingForward = createState([{ path: runtimeCompositionPath, text: "export const runtime = {};" }]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${toolCompositionPath}:1: Coding Agent tool composition must consume ToolEnvironment, not Node tools`,
		);
		expect(findCodingAgentArchitectureViolations(missingForward)).toContain(
			`${runtimeCompositionPath}: Coding Agent Composition must forward the host ToolEnvironment factory`,
		);
	});

	it("keeps path policy portable and selects Node ToolEnvironment mechanisms in platform roots", () => {
		const pathPolicyPath = `${SOURCE_ROOT}/tool-policy/path/path-policy-boundaries.ts`;
		const cliCompositionPath = "packages/cli-app/src/rpc/runtime-host/cli-session-assembly.ts";
		const cliFactoryPath = "packages/cli-app/src/rpc/runtime-host/cli-tool-environment.ts";
		const importingNode = createState([{ path: pathPolicyPath, text: 'import { resolve } from "node:path";' }]);
		const selectingLegacyFactory = createState([
			{
				path: cliCompositionPath,
				text: "createToolEnvironment: createCodingAgentNodeToolEnvironment,",
			},
		]);
		const incompletePlatformFactory = createState([
			{ path: cliFactoryPath, text: "createNodeHostCodingToolEnvironment();" },
		]);
		const completePlatformFactory = createState([
			{
				path: cliFactoryPath,
				text: "createNodeHostCodingToolEnvironment({ editPathPolicy: createCodingAgentEditPathPolicy(boundaries), writePathPolicy: createCodingAgentWritePathPolicy(boundaries) }); createNodeHostSessionCommandEnvironment(); createNodeSandboxCodingToolEnvironment();",
			},
		]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${pathPolicyPath}:1: Coding Agent path policy must consume Host path boundaries`,
		);
		expect(findCodingAgentArchitectureViolations(selectingLegacyFactory)).toContain(
			`${cliCompositionPath}: platform Composition Root must not select Coding Agent's legacy Node factory`,
		);
		expect(findCodingAgentArchitectureViolations(incompletePlatformFactory)).toContain(
			`${cliFactoryPath}: platform environment factory must compose Node mechanisms with Coding Agent policies`,
		);
		expect(findCodingAgentArchitectureViolations(completePlatformFactory)).not.toContain(
			`${cliFactoryPath}: platform environment factory must compose Node mechanisms with Coding Agent policies`,
		);
	});

	it("keeps Session execution behind the injected Host environment", () => {
		const executionPath = `${SOURCE_ROOT}/host/session-execution/execution-runtime.ts`;
		const sandboxPath = `${SOURCE_ROOT}/host/session-execution/sandbox-tool-registrations.ts`;
		const state = createState([
			{ path: executionPath, text: 'import { spawn } from "node:child_process";' },
			{ path: sandboxPath, text: 'import { createNodeSandboxHost } from "@vetta/runtime-node/sandbox";' },
		]);

		expect(findCodingAgentArchitectureViolations(state)).toEqual([
			`${executionPath}:1: Session execution must consume its Host environment Port`,
			`${sandboxPath}:1: Session execution must consume its Host environment Port`,
		]);
	});

	it.each([
		`${SOURCE_ROOT}/adapters/runtime-tools/command-process-host.ts`,
		`${SOURCE_ROOT}/adapters/runtime-tools/desktop-command-port-adapter.ts`,
		`${SOURCE_ROOT}/adapters/runtime-tools/doc-to-pdf-operations.ts`,
		`${SOURCE_ROOT}/adapters/runtime-tools/edit-path-policy.ts`,
		`${SOURCE_ROOT}/adapters/runtime-tools/path-policy-boundaries.ts`,
		`${SOURCE_ROOT}/adapters/runtime-tools/write-path-policy.ts`,
		`${SOURCE_ROOT}/adapters/runtime-tools/executables/resolver.ts`,
	])("keeps retired Node tool implementation out of %s", (path) => {
		const state = createState([{ path, text: "export const implementation = {};" }]);
		expect(findCodingAgentArchitectureViolations(state)).toContain(
			`${path}: Node command and executable implementations belong to runtime-node`,
		);
	});

	it("keeps Prompt domain policy behind the request runtime Port", () => {
		const adapterPath = `${SOURCE_ROOT}/adapters/runtime-core/prompt-request-adapter.ts`;
		const importingDomainImplementation = createState([
			{
				path: adapterPath,
				text: 'import { buildPluginPromptContext } from "../../plugins/runtime/plugin-prompt-context.js";',
			},
		]);
		const missingRuntimePort = createState([
			{
				path: adapterPath,
				text: "export class CodingAgentPromptRequestAdapter {}",
			},
		]);

		expect(findCodingAgentArchitectureViolations(importingDomainImplementation)).toContain(
			`${adapterPath}:1: Prompt request Adapter must delegate domain policy`,
		);
		expect(findCodingAgentArchitectureViolations(missingRuntimePort)).toContain(
			`${adapterPath}: Prompt request Adapter must delegate preparation to its runtime Port`,
		);
	});

	it.each([
		`${SOURCE_ROOT}/adapters/runtime-core/ecosystem-hook-tool-wrapper.ts`,
		`${SOURCE_ROOT}/adapters/runtime-core/extension-observation-adapter.ts`,
		`${SOURCE_ROOT}/adapters/runtime-core/extension-run-adapter.ts`,
		`${SOURCE_ROOT}/adapters/runtime-core/extension-tool-wrapper.ts`,
		`${SOURCE_ROOT}/adapters/extensions/extension-tool-interceptor.ts`,
	])("keeps retired Adapter ownership path out of %s", (path) => {
		const state = createState([{ path, text: "export const implementation = {};" }]);
		expect(findCodingAgentArchitectureViolations(state)).toContain(
			`${path}: implementation belongs to its Extension or ecosystem owner`,
		);
	});

	it.each([
		`${SOURCE_ROOT}/auth/storage/file-auth-storage-backend.ts`,
		`${SOURCE_ROOT}/settings/storage/file-settings-storage.ts`,
	])("keeps retired Node state backend out of %s", (path) => {
		const state = createState([{ path, text: "export const backend = {};" }]);
		expect(findCodingAgentArchitectureViolations(state)).toContain(
			`${path}: Node file state backends belong to runtime-node`,
		);
	});

	it("keeps Settings semantics independent from Node storage", () => {
		const importingNode = createState([
			{
				path: `${SOURCE_ROOT}/settings/runtime/create-settings-runtime.ts`,
				text: 'import { NodeScopedTextStorage } from "@vetta/runtime-node/host";',
			},
		]);
		const selectingFileDefault = createState([
			{
				path: `${SOURCE_ROOT}/settings/index.ts`,
				text: "export const SettingsRuntime = { create: createFileSettingsRuntime };",
			},
		]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${SOURCE_ROOT}/settings/runtime/create-settings-runtime.ts:1: Settings semantics must consume SettingsStoragePort, not a Node backend`,
		);
		expect(findCodingAgentArchitectureViolations(selectingFileDefault)).toContain(
			`${SOURCE_ROOT}/settings/index.ts: SettingsRuntime must not select a Node file backend`,
		);
	});

	it("keeps Node module and process execution out of Extension semantics", () => {
		const loaderPath = `${SOURCE_ROOT}/extensions/runtime/loading/extension-module-loader.ts`;
		const commandPath = `${SOURCE_ROOT}/extensions/runtime/exec-command.ts`;
		const state = createState([
			{ path: loaderPath, text: 'import { createJiti } from "@mariozechner/jiti";' },
			{ path: commandPath, text: 'import { spawn } from "node:child_process";' },
		]);

		expect(findCodingAgentArchitectureViolations(state)).toContain(
			`${loaderPath}: Node Extension execution belongs behind Host Ports`,
		);
		expect(findCodingAgentArchitectureViolations(state)).toContain(
			`${commandPath}: Node Extension execution belongs behind Host Ports`,
		);
	});

	it("keeps all Extension contracts independent from Node modules and globals", () => {
		const modulePath = `${SOURCE_ROOT}/extensions/events/tool-events.ts`;
		const globalPath = `${SOURCE_ROOT}/extensions/infrastructure.ts`;
		const importingNode = createState([
			{ path: modulePath, text: 'import type { ToolInput } from "@vetta/runtime-node/coding";' },
		]);
		const usingNodeGlobals = createState([
			{
				path: globalPath,
				text: "export type Operations = { data: Buffer; env: NodeJS.ProcessEnv };",
			},
		]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${modulePath}:1: Extension semantics must not depend on Node implementations`,
		);
		expect(findCodingAgentArchitectureViolations(usingNodeGlobals)).toContain(
			`${globalPath}: Extension contracts must use platform-neutral data types`,
		);
	});

	it("keeps Resource Package Node effects behind required Host Ports", () => {
		const effectsPath = `${SOURCE_ROOT}/resources/packages/package-effects.ts`;
		const runtimePath = `${SOURCE_ROOT}/resources/packages/package-source-runtime.ts`;
		const hostPath = `${SOURCE_ROOT}/host/coding-agent-resource-runtime.ts`;
		const retiredEffects = createState([{ path: effectsPath, text: "export class NodeCommands {}" }]);
		const optionalPorts = createState([
			{
				path: runtimePath,
				text: "export interface ResourcePackageRuntimeOptions { commands?: ResourcePackageCommandPort }",
			},
		]);
		const selectingDefaults = createState([
			{
				path: runtimePath,
				text: "const commands = new NodeResourcePackageCommands(); const offline = process.env.PI_OFFLINE;",
			},
		]);
		const retiredHostComposition = createState([{ path: hostPath, text: "export const runtime = {};" }]);
		const missingLocationFacts = createState([
			{
				path: runtimePath,
				text: "export interface ResourcePackageRuntimeOptions { commands: ResourcePackageCommandPort; registry: ResourcePackageRegistryPort; environment: ResourcePackageEnvironmentPort }",
			},
		]);

		expect(findCodingAgentArchitectureViolations(retiredEffects)).toContain(
			`${effectsPath}: Resource Package Node effects belong to runtime-node`,
		);
		expect(findCodingAgentArchitectureViolations(optionalPorts)).toContain(
			`${runtimePath}: ResourcePackageRuntimeOptions must require all Host Ports`,
		);
		expect(findCodingAgentArchitectureViolations(missingLocationFacts)).toContain(
			`${runtimePath}: ResourcePackageRuntimeOptions must require all Host Ports`,
		);
		expect(findCodingAgentArchitectureViolations(selectingDefaults)).toContain(
			`${runtimePath}: Resource Package runtime must not select Node defaults`,
		);
		expect(findCodingAgentArchitectureViolations(retiredHostComposition)).toContain(
			`${hostPath}: Node resource composition belongs to application hosts`,
		);
	});

	it("keeps RPC protocol semantics independent from Node transport", () => {
		const rpcModePath = `${SOURCE_ROOT}/modes/rpc/rpc-mode.ts`;
		const bridgePath = `${SOURCE_ROOT}/modes/rpc/rpc-host-bridge.ts`;
		const clientPath = `${SOURCE_ROOT}/modes/rpc/rpc-client.ts`;
		const hostPath = "packages/cli-app/src/rpc/runtime-host/runtime-host.ts";
		const nodeClientTransportPath = "packages/cli-app/src/rpc/node-rpc-client-transport.ts";
		const importingNode = createState([
			{ path: rpcModePath, text: 'import { randomUUID } from "node:crypto"; export interface RunRpcModeOptions {}' },
		]);
		const directRandomness = createState([{ path: bridgePath, text: "const id = randomUUID();" }]);
		const missingTransport = createState([
			{
				path: rpcModePath,
				text: "export interface RunRpcModeOptions { readonly input: NodeJS.ReadableStream; }",
			},
		]);
		const missingHostInjection = createState([
			{ path: hostPath, text: "runRpcModeWithCapabilities(session, { exit: process.exit });" },
		]);
		const nodeBoundClientCore = createState([
			{ path: clientPath, text: 'import { spawn } from "node:child_process";' },
		]);
		const missingClientPort = createState([
			{ path: nodeClientTransportPath, text: "export class NodeRpcClientTransport {}" },
		]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${rpcModePath}:1: RPC protocol semantics must consume host transport and ID ports`,
		);
		expect(findCodingAgentArchitectureViolations(directRandomness)).toContain(
			`${bridgePath}: RPC protocol semantics must not access Node process or randomness directly`,
		);
		expect(findCodingAgentArchitectureViolations(missingTransport)).toContain(
			`${rpcModePath}: RPC mode must require explicit transport and request ID ports`,
		);
		expect(findCodingAgentArchitectureViolations(missingHostInjection)).toContain(
			`${hostPath}: Node RPC Host must inject JSONL transport, exit and request ID ports`,
		);
		expect(findCodingAgentArchitectureViolations(nodeBoundClientCore)).toContain(
			`${clientPath}:1: RPC protocol semantics must consume host transport and ID ports`,
		);
		expect(findCodingAgentArchitectureViolations(missingClientPort)).toContain(
			`${nodeClientTransportPath}: Node RPC Client transport must implement the public RPC Port`,
		);
	});

	it("keeps the SDK Session factory independent from Node identity and persistence", () => {
		const runtimeFactoryPath = `${SOURCE_ROOT}/host/sdk-session/runtime-factory.ts`;
		const sessionHostPath = `${SOURCE_ROOT}/host/sdk-session/session-host.ts`;
		const importingNode = createState([
			{ path: runtimeFactoryPath, text: 'import { randomUUID } from "node:crypto";' },
		]);
		const selectingDefaults = createState([
			{
				path: runtimeFactoryPath,
				text: "const cwd = process.cwd(); const catalog = new FileConversationRuntimeSessionCatalog();",
			},
		]);
		const missingPort = createState([
			{ path: runtimeFactoryPath, text: "export interface CodingAgentSdkSessionFactoryOptions {}" },
		]);
		const missingHostInjection = createState([
			{ path: sessionHostPath, text: "return createCodingAgentSdkSession({ storage });" },
		]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${runtimeFactoryPath}:1: SDK Session factory must consume an identity runtime Port`,
		);
		expect(findCodingAgentArchitectureViolations(selectingDefaults)).toContain(
			`${runtimeFactoryPath}: SDK Session factory must not select Node identity defaults`,
		);
		expect(findCodingAgentArchitectureViolations(missingPort)).toContain(
			`${runtimeFactoryPath}: SDK Session factory must require the complete identity runtime Port`,
		);
		expect(findCodingAgentArchitectureViolations(missingHostInjection)).toContain(
			`${sessionHostPath}: default SDK Host must inject the Node Session identity runtime`,
		);
	});

	it("requires application-owned resource and Prompt composition", () => {
		const promptFactoryPath = `${SOURCE_ROOT}/composition/turn/prompt-runtime-factory.ts`;
		const publicResourcesPath = `${SOURCE_ROOT}/public-api/resources.ts`;
		const compositionOptionsPath = `${SOURCE_ROOT}/composition/contracts/runtime-composition-options.ts`;
		const transactionPath = `${SOURCE_ROOT}/composition/session-initialization/transaction.ts`;
		const cliControlPath = `${SOURCE_ROOT}/host/coding-agent-cli-control.ts`;
		const state = createState([
			{ path: promptFactoryPath, text: "export function createPromptRuntime() {}" },
			{ path: publicResourcesPath, text: "export function createCodingAgentSessionResourceRuntime() {}" },
			{ path: compositionOptionsPath, text: "export interface Options {}" },
			{ path: transactionPath, text: "export function initializeSession() {}" },
			{ path: cliControlPath, text: "export function createControl() {}" },
		]);

		expect(findCodingAgentArchitectureViolations(state)).toEqual(
			expect.arrayContaining([
				`${promptFactoryPath}: Prompt resource selection belongs to application hosts`,
				`${publicResourcesPath}: Resources facade must expose portable constructors only`,
				`${compositionOptionsPath}: Composition must accept host-owned Prompt runtime sources`,
				`${transactionPath}: Session initialization must forward host-owned Prompt runtime sources`,
				`${cliControlPath}: CLI package commands must receive an explicit runtime factory`,
			]),
		);
	});

	it("keeps Resource Package discovery and projection on ResourceAccessPort", () => {
		const discoveryPath = `${SOURCE_ROOT}/resources/packages/resource-discovery.ts`;
		const projectionPath = `${SOURCE_ROOT}/resources/packages/resource-projection.ts`;
		const runtimePath = `${SOURCE_ROOT}/resources/packages/package-source-runtime.ts`;
		const lifecyclePath = `${SOURCE_ROOT}/resources/packages/package-lifecycle.ts`;
		const state = createState([
			{ path: discoveryPath, text: 'import { readdirSync } from "node:fs";' },
			{ path: projectionPath, text: 'import { existsSync } from "node:fs";' },
			{ path: runtimePath, text: 'import { existsSync } from "node:fs";' },
			{ path: lifecyclePath, text: 'import { rm } from "node:fs/promises";' },
		]);

		const violations = findCodingAgentArchitectureViolations(state);
		expect(violations).toContain(
			`${discoveryPath}:1: portable resource access must consume ResourceAccessPort, not a Node implementation`,
		);
		expect(violations).toContain(
			`${projectionPath}:1: portable resource access must consume ResourceAccessPort, not a Node implementation`,
		);
		expect(violations).toContain(
			`${runtimePath}:1: portable resource access must consume ResourceAccessPort, not a Node implementation`,
		);
		expect(violations).toContain(
			`${lifecyclePath}:1: portable resource access must consume ResourceAccessPort, not a Node implementation`,
		);
	});

	it("keeps Resource Package source parsing and locations portable and separate", () => {
		const sourceSpecPath = `${SOURCE_ROOT}/resources/packages/source-spec.ts`;
		const locationsPath = `${SOURCE_ROOT}/resources/packages/resource-package-locations.ts`;
		const importingNode = createState([
			{ path: sourceSpecPath, text: 'import { createHash } from "node:crypto";' },
			{ path: locationsPath, text: 'import path from "node:path";' },
		]);
		const mixedResponsibilities = createState([
			{ path: sourceSpecPath, text: "export class ResourcePackageLocations {}" },
		]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toEqual(
			expect.arrayContaining([
				`${sourceSpecPath}:1: portable resource access must consume ResourceAccessPort, not a Node implementation`,
				`${locationsPath}:1: portable resource access must consume ResourceAccessPort, not a Node implementation`,
			]),
		);
		expect(findCodingAgentArchitectureViolations(mixedResponsibilities)).toContain(
			`${sourceSpecPath}: Resource source parsing must not own package location policy`,
		);
	});

	it("keeps Bash process implementation behind runtime-node", () => {
		const commandPath = `${SOURCE_ROOT}/host/command-execution/local-bash-executor.ts`;
		const importingNode = createState([{ path: commandPath, text: 'import { spawn } from "node:child_process";' }]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${commandPath}:1: command execution implementation belongs to runtime-node, not Coding Agent`,
		);
	});

	it("keeps OS sandbox implementation behind injected Host Services", () => {
		const sandboxHostRoot = `${SOURCE_ROOT}/host/session-execution/sandbox/`;
		const retiredAdapterPath = `${SOURCE_ROOT}/adapters/runtime-core/execution-mode/sandbox-tools.ts`;
		const retiredPath = `${sandboxHostRoot}linux-bwrap-tools.ts`;
		const policyPath = `${sandboxHostRoot}sandbox-tool-utils.ts`;
		const retiredAdapter = createState([{ path: retiredAdapterPath, text: "export function create() {}" }]);
		const retiredImplementation = createState([
			{ path: retiredPath, text: 'import { spawn } from "node:child_process";' },
		]);
		const nodeGlobalPolicy = createState([{ path: policyPath, text: "const platform = process.platform;" }]);
		const selectingNodeService = createState([
			{ path: policyPath, text: 'import { findSessionGrant } from "@vetta/runtime-node/sandbox";' },
		]);
		const selectingNodeTools = createState([
			{ path: policyPath, text: 'import { createReadToolRegistration } from "@vetta/runtime-node/coding";' },
		]);

		expect(findCodingAgentArchitectureViolations(retiredAdapter)).toContain(
			`${retiredAdapterPath}: sandbox host policy must not return to the Runtime adapter directory`,
		);
		expect(findCodingAgentArchitectureViolations(retiredImplementation)).toContain(
			`${retiredPath}: OS sandbox implementation belongs to runtime-node`,
		);
		expect(findCodingAgentArchitectureViolations(retiredImplementation)).toContain(
			`${retiredPath}:1: OS sandbox implementation belongs to runtime-node`,
		);
		expect(findCodingAgentArchitectureViolations(nodeGlobalPolicy)).toContain(
			`${policyPath}: sandbox policy must consume Host Services, not Node globals`,
		);
		expect(findCodingAgentArchitectureViolations(selectingNodeService)).toContain(
			`${policyPath}:1: sandbox policy must consume injected Host Services`,
		);
		expect(findCodingAgentArchitectureViolations(selectingNodeTools)).toContain(
			`${policyPath}:1: sandbox policy must consume injected Host Services`,
		);
	});

	it("keeps Tool Result artifact files behind an injected Host policy", () => {
		const policyPath = `${SOURCE_ROOT}/tool-results/result-policy.ts`;
		const retiredStorePath = `${SOURCE_ROOT}/tool-results/file-result-artifact-store.ts`;
		const compositionPath = `${SOURCE_ROOT}/composition/runtime-composition.ts`;
		const importingNode = createState([{ path: policyPath, text: 'import { Buffer } from "node:buffer";' }]);
		const retiredStore = createState([
			{ path: retiredStorePath, text: 'import { writeFile } from "node:fs/promises";' },
		]);
		const missingPolicy = createState([{ path: compositionPath, text: "export function create() {}" }]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${policyPath}:1: Tool Result policy must consume an Artifact Store contract`,
		);
		expect(findCodingAgentArchitectureViolations(retiredStore)).toContain(
			`${retiredStorePath}: result artifact file implementation belongs to runtime-node`,
		);
		expect(findCodingAgentArchitectureViolations(missingPolicy)).toContain(
			`${compositionPath}: Coding Agent Composition must forward the host Tool Result policy`,
		);
	});

	it("keeps Coding Agent Bootstrap independent from Node host selection", () => {
		const bootstrapPath = `${SOURCE_ROOT}/bootstrap/coding-agent-bootstrap.ts`;
		const retiredPath = `${SOURCE_ROOT}/host/coding-agent-host-bootstrap.ts`;
		const importingNode = createState([
			{ path: bootstrapPath, text: 'import { join } from "node:path"; const cwd = process.cwd();' },
		]);
		const retiredBootstrap = createState([{ path: retiredPath, text: "export function create() {}" }]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${bootstrapPath}: Coding Agent Bootstrap must consume host-owned state and environment facts`,
		);
		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${bootstrapPath}:1: Coding Agent Bootstrap must not select a Node implementation`,
		);
		expect(findCodingAgentArchitectureViolations(retiredBootstrap)).toContain(
			`${retiredPath}: platform bootstrap belongs to the application Composition Root`,
		);
	});

	it("allows CLI Bootstrap and resource Node selection to use adjacent host modules", () => {
		const cliCompositionPath = "packages/cli-app/src/coding-agent-bootstrap.ts";
		const cliResourceCompositionPath = "packages/cli-app/src/coding-agent-resource-runtime.ts";
		const completeHost = createState([
			{
				path: cliCompositionPath,
				text: "createCodingAgentBootstrap(); new NodeTransactionalTextStorage(); runCodingAgentStartupMigrations({ cwd, agentDir }); createCliSettingsRuntime(); createCliSessionResourceRuntime();",
			},
			{
				path: cliResourceCompositionPath,
				text: "new NodeScopedTextStorage(); createNodeResourcePackageHost(); createNodeCommandExecutor();",
			},
		]);
		const missingResourceHost = createState([
			{
				path: cliCompositionPath,
				text: "createCodingAgentBootstrap(); new NodeTransactionalTextStorage(); runCodingAgentStartupMigrations({ cwd, agentDir }); createCliSettingsRuntime(); createCliSessionResourceRuntime();",
			},
		]);

		expect(findCodingAgentArchitectureViolations(completeHost)).not.toContain(
			`${cliCompositionPath}: CLI host composition must select Node dependencies explicitly`,
		);
		expect(findCodingAgentArchitectureViolations(missingResourceHost)).toContain(
			`${cliCompositionPath}: CLI host composition must select Node dependencies explicitly`,
		);
	});

	it("keeps Extension discovery and loading behind explicit Host Ports", () => {
		const discoveryPath = `${SOURCE_ROOT}/extensions/runtime/discovery/extension-paths.ts`;
		const runtimeContractPath = `${SOURCE_ROOT}/resources/contracts/resource-runtime.ts`;
		const importingNode = createState([{ path: discoveryPath, text: 'import { readdir } from "node:fs/promises";' }]);
		const missingPorts = createState([
			{
				path: runtimeContractPath,
				text: "export interface SessionResourceRuntimeOptions { resourceAccess: ResourceAccessPort }",
			},
		]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${discoveryPath}:1: portable resource access must consume ResourceAccessPort, not a Node implementation`,
		);
		expect(findCodingAgentArchitectureViolations(missingPorts)).toContain(
			`${runtimeContractPath}: SessionResourceRuntimeOptions must require Extension Host Ports`,
		);
	});

	it("keeps context resource discovery behind the asynchronous ResourceAccessPort", () => {
		const contextPath = `${SOURCE_ROOT}/resources/runtime/context-resources.ts`;
		const runtimeContractPath = `${SOURCE_ROOT}/resources/contracts/resource-runtime.ts`;
		const importingNode = createState([{ path: contextPath, text: 'import { readFile } from "node:fs/promises";' }]);
		const missingPort = createState([
			{ path: runtimeContractPath, text: "export interface SessionResourceRuntimeOptions {}" },
		]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${contextPath}:1: portable resource access must consume ResourceAccessPort, not a Node implementation`,
		);
		expect(findCodingAgentArchitectureViolations(missingPort)).toContain(
			`${runtimeContractPath}: SessionResourceRuntimeOptions must require ResourceAccessPort`,
		);
	});

	it("keeps resource path resolution behind ResourcePathPort", () => {
		const statePath = `${SOURCE_ROOT}/resources/runtime/resource-state.ts`;
		const runtimePath = `${SOURCE_ROOT}/resources/runtime/session-resource-runtime.ts`;
		const patternsPath = `${SOURCE_ROOT}/resources/packages/resource-patterns.ts`;
		const state = createState([
			{ path: statePath, text: 'import { homedir } from "node:os";' },
			{ path: runtimePath, text: 'import { resolve } from "node:path";' },
			{ path: patternsPath, text: 'import { relative } from "node:path";' },
		]);

		expect(findCodingAgentArchitectureViolations(state)).toEqual(
			expect.arrayContaining([
				`${statePath}:1: portable resource access must consume ResourceAccessPort, not a Node implementation`,
				`${runtimePath}:1: portable resource access must consume ResourceAccessPort, not a Node implementation`,
				`${patternsPath}:1: portable resource access must consume ResourceAccessPort, not a Node implementation`,
			]),
		);
	});

	it("keeps theme resource I/O behind ResourceAccessPort", () => {
		const themeResourcesPath = `${SOURCE_ROOT}/resources/runtime/theme-resources.ts`;
		const runtimeContractPath = `${SOURCE_ROOT}/resources/contracts/resource-runtime.ts`;
		const importingNode = createState([{ path: themeResourcesPath, text: 'import { readFile } from "node:fs";' }]);
		const missingParser = createState([
			{ path: runtimeContractPath, text: "export interface SessionResourceRuntimeOptions {}" },
		]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${themeResourcesPath}:1: portable resource access must consume ResourceAccessPort, not a Node implementation`,
		);
		expect(findCodingAgentArchitectureViolations(missingParser)).toContain(
			`${runtimeContractPath}: SessionResourceRuntimeOptions must require ThemeResourceParser`,
		);
	});

	it("keeps Skill and Scene content materialized behind ResourceAccessPort", () => {
		const discoveryPath = `${SOURCE_ROOT}/resources/skills/discovery.ts`;
		const consumerPath = `${SOURCE_ROOT}/resources/prompt-resources/prompt-resource-expander.ts`;
		const importingNode = createState([{ path: discoveryPath, text: 'import { readFile } from "node:fs";' }]);
		const lazyRead = createState([{ path: consumerPath, text: "export const content = readSkillContent(skill);" }]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${discoveryPath}:1: portable resource access must consume ResourceAccessPort, not a Node implementation`,
		);
		expect(findCodingAgentArchitectureViolations(lazyRead)).toContain(
			`${consumerPath}: Skill consumers must use the materialized resource snapshot`,
		);
	});

	it("keeps Prompt template discovery behind ResourceAccessPort", () => {
		const discoveryPath = `${SOURCE_ROOT}/resources/prompts/discovery.ts`;
		const statePath = `${SOURCE_ROOT}/resources/runtime/prompt-resource-state.ts`;
		const importingNode = createState([{ path: discoveryPath, text: 'import { readFile } from "node:fs";' }]);
		const selectingNode = createState([
			{ path: statePath, text: 'import { createNodeResourceAccess } from "@vetta/runtime-node/host";' },
		]);

		expect(findCodingAgentArchitectureViolations(importingNode)).toContain(
			`${discoveryPath}:1: portable resource access must consume ResourceAccessPort, not a Node implementation`,
		);
		expect(findCodingAgentArchitectureViolations(selectingNode)).toContain(
			`${statePath}:1: portable resource access must consume ResourceAccessPort, not a Node implementation`,
		);
	});

	it("keeps Knowledge definitions portable and platform implementations host-owned", () => {
		const featurePath = `${SOURCE_ROOT}/features/knowledge/list-tags-tool.ts`;
		const retiredFactoryPath = `${SOURCE_ROOT}/composition/coding-agent-knowledge-runtime.ts`;
		const optionsPath = `${SOURCE_ROOT}/composition/contracts/runtime-composition-options.ts`;
		const nodeToolPath = "packages/runtime-node/src/coding/tools/kb-list-tags/index.ts";
		const nodeEntryPath = "packages/runtime-node/src/coding/index.ts";
		const cliPath = "packages/cli-app/src/rpc/runtime-host/cli-session-assembly.ts";
		const state = createState([
			{ path: featurePath, text: 'import { join } from "node:path";' },
			{ path: retiredFactoryPath, text: "export function createKnowledge() {}" },
			{
				path: optionsPath,
				text: "export interface Options { knowledgeRoot?: string; knowledgeEnabled?: boolean }",
			},
			{ path: nodeToolPath, text: "export const tool = {};" },
			{ path: nodeEntryPath, text: 'export * from "./tools/kb-list-tags/index.js";' },
			{ path: cliPath, text: "createCodingAgentRuntimeComposition({});" },
		]);

		expect(findCodingAgentArchitectureViolations(state)).toEqual(
			expect.arrayContaining([
				`${featurePath}:1: Knowledge Feature must consume portable operations`,
				`${retiredFactoryPath}: Knowledge platform implementation belongs to application hosts`,
				`${optionsPath}: Composition must accept an explicit Knowledge runtime`,
				`${optionsPath}: Composition must not infer Knowledge platform availability`,
				`${nodeToolPath}: Knowledge Tool definitions belong to the Coding Agent feature`,
				`${nodeEntryPath}: runtime-node must not export Coding Agent Knowledge Tools`,
				`${cliPath}: Node Host Composition Root must inject createNodeKnowledgeRuntime`,
			]),
		);
	});

	it("keeps Memory definitions portable and platform storage host-owned", () => {
		const featurePath = `${SOURCE_ROOT}/memory/memory-store.ts`;
		const optionsPath = `${SOURCE_ROOT}/composition/contracts/runtime-composition-options.ts`;
		const peripheralPath = `${SOURCE_ROOT}/composition/session-initialization/peripheral-assembly.ts`;
		const nodeToolPath = "packages/runtime-node/src/coding/tools/memory/memory-tool.ts";
		const nodeEntryPath = "packages/runtime-node/src/coding/index.ts";
		const cliPath = "packages/cli-app/src/rpc/runtime-host/cli-session-assembly.ts";
		const state = createState([
			{ path: featurePath, text: 'import { readFile } from "node:fs";' },
			{ path: optionsPath, text: "export interface Options {}" },
			{ path: peripheralPath, text: "new CodingAgentMemoryRolloverOrchestrator()" },
			{ path: nodeToolPath, text: "export const tool = {};" },
			{ path: nodeEntryPath, text: 'export * from "./tools/memory/index.js";' },
			{ path: cliPath, text: "createCodingAgentRuntimeComposition({});" },
		]);

		expect(findCodingAgentArchitectureViolations(state)).toEqual(
			expect.arrayContaining([
				`${featurePath}:1: Memory semantics must consume portable storage ports`,
				`${optionsPath}: Composition must accept an explicit Memory runtime factory`,
				`${peripheralPath}: Memory host storage must be selected by the Composition Root`,
				`${nodeToolPath}: Memory Tool definitions belong to the Coding Agent feature`,
				`${nodeEntryPath}: runtime-node must not export Coding Agent Memory Tools`,
				`${cliPath}: Node Host Composition Root must inject NodeTextFileStorage for Memory`,
			]),
		);
	});

	it("keeps Ask User Question definitions in the portable Coding Agent feature", () => {
		const featurePath = `${SOURCE_ROOT}/features/ask-user-question/tool/ask-user-question-tool.ts`;
		const retiredCompositionPath = `${SOURCE_ROOT}/composition/tool-surface/ask-user-question-feature.ts`;
		const nodeToolPath = "packages/runtime-node/src/coding/tools/ask-user-question/index.ts";
		const nodeEntryPath = "packages/runtime-node/src/coding/index.ts";
		const state = createState([
			{ path: featurePath, text: 'import { join } from "node:path";' },
			{ path: retiredCompositionPath, text: "export function createFeature() {}" },
			{ path: nodeToolPath, text: "export const tool = {};" },
			{ path: nodeEntryPath, text: 'export * from "./tools/ask-user-question/index.js";' },
		]);

		expect(findCodingAgentArchitectureViolations(state)).toEqual(
			expect.arrayContaining([
				`${featurePath}:1: Ask User Question Feature must consume portable Runtime ports`,
				`${retiredCompositionPath}: Ask User Question belongs to its Coding Agent feature`,
				`${nodeToolPath}: Ask User Question Tool definitions belong to the Coding Agent feature`,
				`${nodeEntryPath}: runtime-node must not export Coding Agent Ask User Question Tools`,
			]),
		);
	});

	it("keeps Invoke Skill definitions in the portable Coding Agent Skill domain", () => {
		const skillToolPath = `${SOURCE_ROOT}/resources/skills/tool/invoke-skill-tool.ts`;
		const nodeToolPath = "packages/runtime-node/src/coding/tools/invoke-skill/index.ts";
		const nodeEntryPath = "packages/runtime-node/src/coding/index.ts";
		const state = createState([
			{ path: skillToolPath, text: 'import { readFile } from "node:fs";' },
			{ path: nodeToolPath, text: "export const tool = {};" },
			{ path: nodeEntryPath, text: 'export * from "./tools/invoke-skill/index.js";' },
		]);

		expect(findCodingAgentArchitectureViolations(state)).toEqual(
			expect.arrayContaining([
				`${skillToolPath}:1: Skill semantics must consume portable Runtime and resource ports`,
				`${nodeToolPath}: Invoke Skill Tool definitions belong to the Coding Agent Skill domain`,
				`${nodeEntryPath}: runtime-node must not export Coding Agent Invoke Skill Tools`,
			]),
		);
	});

	it("keeps MCP Tool Search in runtime-mcp without a runtime-node duplicate", () => {
		const nodeToolPath = "packages/runtime-node/src/coding/tools/tool-search/index.ts";
		const nodeEntryPath = "packages/runtime-node/src/coding/index.ts";
		const state = createState([
			{ path: nodeToolPath, text: "export const tool = {};" },
			{ path: nodeEntryPath, text: 'export * from "./tools/tool-search/index.js";' },
		]);

		expect(findCodingAgentArchitectureViolations(state)).toEqual(
			expect.arrayContaining([
				`${nodeToolPath}: MCP Tool Search belongs to runtime-mcp`,
				`${nodeEntryPath}: runtime-node must not duplicate runtime-mcp Tool Search`,
			]),
		);
	});

	it("keeps Subagent control Tool semantics in Coding Agent", () => {
		const productToolPath = "packages/coding-agent/src/composition/subagent/tools/spawn-agent/spawn-agent-tool.ts";
		const nodeToolPath = "packages/runtime-node/src/coding/tools/spawn-agent/index.ts";
		const nodeEntryPath = "packages/runtime-node/src/coding/index.ts";
		const state = createState([
			{ path: productToolPath, text: 'import { platform } from "node:os";' },
			{ path: nodeToolPath, text: "export const tool = {};" },
			{ path: nodeEntryPath, text: 'export * from "./tools/spawn-agent/index.js";' },
		]);

		expect(findCodingAgentArchitectureViolations(state)).toEqual(
			expect.arrayContaining([
				`${productToolPath}:1: Subagent control Tools must consume portable Runtime Ports`,
				`${nodeToolPath}: Subagent control Tool definitions belong to the Coding Agent Subagent feature`,
				`${nodeEntryPath}: runtime-node must not export Coding Agent Subagent control Tools`,
			]),
		);
	});

	it("rejects retired architecture-layer terminology in implementation names", () => {
		const retiredTerm = ["pro", "duct"].join("");
		const sourcePath = `${SOURCE_ROOT}/model-context/${retiredTerm}-prompt.ts`;
		const sourceState = createState([{ path: sourcePath, text: `export type ${retiredTerm}Policy = {};` }]);
		const exportState = createState([], {
			exports: { ".": "./dist/index.js", [`./${retiredTerm}-prompt`]: "./dist/prompt.js" },
		});

		expect(findCodingAgentArchitectureViolations(sourceState)).toContain(
			`${sourcePath}: implementation uses a retired architecture-layer term`,
		);
		expect(findCodingAgentArchitectureViolations(exportState)).toContain(
			`packages/coding-agent/package.json: export ./${retiredTerm}-prompt uses a retired architecture-layer term`,
		);
	});
});
