import { describe, expect, it } from "vitest";
import {
	collectCodingAgentMigrationResidue,
	findCodingAgentMigrationResidueViolations,
	MIGRATION_RESIDUE_LIMITS,
} from "./check-coding-agent-migration-residue.mjs";

describe("Coding Agent migration residue gate", () => {
	it("accepts production files without retired migration seams", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/adapters/runtime-core/model-adapter.ts",
				text: 'import type { Model } from "../../models/index.js";',
			},
			{
				path: "packages/coding-agent/src/composition/runtime-composition.ts",
				text: "export function createRuntimeComposition() {}",
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([]);
	});

	it("rejects retired Extension compatibility migration contracts", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/host/coding-agent-extension-compatibility.ts",
				text: [
					'export * from "./coding-agent-extension-compatibility.js";',
					"export type CodingAgentLegacyExtensionRuntimeCapability = string;",
					"export interface CodingAgentGreenfieldExtensionHostCapabilities {}",
					"export const CODING_AGENT_GREENFIELD_EXTENSION_EVENTS = [];",
					"export function assessCodingAgentExtensionCompatibility() {}",
					"export function resolveCodingAgentGreenfieldExtensionCompatibility() {}",
					"const requiresLegacyRuntime = true;",
				].join("\n"),
			},
			{
				path: "packages/cli-app/src/rpc/runtime-host/runtime-host.ts",
				text: [
					"export const IM_EXTENSION_EVENT_COMPATIBILITY_PROFILE = {};",
					"const GREENFIELD_EXTENSION_EVENT_PROFILE = {};",
					"const GREENFIELD_EXTENSION_HOST_CAPABILITIES = {};",
					"const requirements = bootstrap.extensionCompatibility;",
				].join("\n"),
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/host/coding-agent-extension-compatibility.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/host/coding-agent-extension-compatibility.ts: retired migration reference (coding-agent-extension-compatibility)",
			"packages/coding-agent/src/host/coding-agent-extension-compatibility.ts: retired migration reference (assessCodingAgentExtensionCompatibility)",
			"packages/coding-agent/src/host/coding-agent-extension-compatibility.ts: retired migration reference (CodingAgentLegacyExtensionRuntimeCapability)",
			"packages/coding-agent/src/host/coding-agent-extension-compatibility.ts: retired migration reference (CodingAgentGreenfieldExtensionHostCapabilities)",
			"packages/coding-agent/src/host/coding-agent-extension-compatibility.ts: retired migration reference (CODING_AGENT_GREENFIELD_EXTENSION_EVENTS)",
			"packages/coding-agent/src/host/coding-agent-extension-compatibility.ts: retired migration reference (resolveCodingAgentGreenfieldExtensionCompatibility)",
			"packages/coding-agent/src/host/coding-agent-extension-compatibility.ts: retired migration reference (requiresLegacyRuntime)",
			"packages/cli-app/src/rpc/runtime-host/runtime-host.ts: retired migration reference (IM_EXTENSION_EVENT_COMPATIBILITY_PROFILE)",
			"packages/cli-app/src/rpc/runtime-host/runtime-host.ts: retired migration reference (GREENFIELD_EXTENSION_EVENT_PROFILE)",
			"packages/cli-app/src/rpc/runtime-host/runtime-host.ts: retired migration reference (GREENFIELD_EXTENSION_HOST_CAPABILITIES)",
			"packages/cli-app/src/rpc/runtime-host/runtime-host.ts: retired migration reference (bootstrap.extensionCompatibility)",
		]);
	});

	it("rejects retired SDK Session ownership paths", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/adapters/runtime-core/greenfield-sdk-session-adapter.ts",
				text: "export class GreenfieldSdkSessionAdapter {}",
			},
			{
				path: "packages/coding-agent/src/host/sdk-session/session-host.ts",
				text: 'import "../../composition/greenfield-sdk-session-factory.js";',
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/adapters/runtime-core/greenfield-sdk-session-adapter.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/host/sdk-session/session-host.ts: retired migration reference (composition/greenfield-sdk-session-factory)",
		]);
	});

	it("rejects SDK Session migration identities while allowing the upstream Runtime Session type", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/host/sdk-session/runtime-binding.ts",
				text: [
					'import type { GreenfieldRuntimeSession } from "@vetta/runtime-core";',
					"export function bindGreenfieldSdkSessionRuntime(session: GreenfieldRuntimeSession) {}",
				].join("\n"),
			},
			{
				path: "packages/coding-agent/src/public-api/sdk/sdk-session-contract.ts",
				text: "export type CodingAgentGreenfieldSdkSession = {};",
			},
			{
				path: "packages/coding-agent/src/host/coding-agent-sdk-extension-transition-adapter.ts",
				text: "export interface GreenfieldSdkOwnedResource {}",
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/host/sdk-session/runtime-binding.ts: retired SDK Session migration identity (bindGreenfieldSdkSessionRuntime)",
			"packages/coding-agent/src/public-api/sdk/sdk-session-contract.ts: retired SDK Session migration identity (CodingAgentGreenfieldSdkSession)",
			"packages/coding-agent/src/host/coding-agent-sdk-extension-transition-adapter.ts: retired SDK Session migration identity (GreenfieldSdkOwnedResource)",
		]);
	});

	it("rejects migration filenames in the SDK Session boundary", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/test/sdk/greenfield-sdk-session.test.ts",
				text: "export {};",
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/test/sdk/greenfield-sdk-session.test.ts: retired SDK Session migration filename",
		]);
	});

	it("rejects retired Desktop Runtime migration paths and identities", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/desktop-app/src/main/greenfield-runtime/desktop-greenfield-runtime-candidate.ts",
				text: [
					'import type { GreenfieldRuntimeSession } from "@vetta/runtime-core";',
					"export class DesktopGreenfieldRuntimeCandidate {}",
				].join("\n"),
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"desktopRuntimeMigrationFiles: 1 exceeds migration residue limit 0",
			"desktopRuntimeMigrationIdentities: 1 exceeds migration residue limit 0",
		]);
	});

	it("rejects retired files and symbols", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/adapters/runtime-core/greenfield-tool-adapter.ts",
				text: "export function adaptCodingAgentToolRegistration() {}",
			},
			{
				path: "packages/coding-agent/src/composition/runtime-composition.ts",
				text: 'import "../adapters/runtime-core/greenfield-tool-adapter.js";',
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/adapters/runtime-core/greenfield-tool-adapter.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/adapters/runtime-core/greenfield-tool-adapter.ts: retired migration reference (adaptCodingAgentToolRegistration)",
			"packages/coding-agent/src/composition/runtime-composition.ts: retired migration reference (greenfield-tool-adapter)",
		]);
	});

	it("rejects retired CLI RPC migration identities", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/cli-app/src/rpc/runtime-host/greenfield-runtime-host.ts",
				text: "export function prepareGreenfieldImRuntimeHost() {}",
			},
			{
				path: "packages/cli-app/test/runtime-host.test.ts",
				text: 'import { GreenfieldImRpcSessionAdapter } from "../src/rpc/greenfield-im-rpc-session-adapter.js";',
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/cli-app/src/rpc/runtime-host/greenfield-runtime-host.ts: retired migration file must stay deleted",
			"packages/cli-app/src/rpc/runtime-host/greenfield-runtime-host.ts: retired migration reference (prepareGreenfieldImRuntimeHost)",
			"packages/cli-app/test/runtime-host.test.ts: retired migration reference (greenfield-im-rpc-session-adapter)",
			"packages/cli-app/test/runtime-host.test.ts: retired migration reference (GreenfieldImRpcSessionAdapter)",
			"cliGreenfieldFiles: 1 exceeds migration residue limit 0",
		]);
	});

	it("rejects the retired Composition root identity", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/composition/greenfield-runtime-composition.ts",
				text: [
					'import type { Contract } from "./greenfield-runtime-composition-contract.js";',
					"export function createGreenfieldRuntimeComposition(): GreenfieldRuntimeComposition {}",
				].join("\n"),
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/composition/greenfield-runtime-composition.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/composition/greenfield-runtime-composition.ts: retired migration reference (greenfield-runtime-composition)",
			"packages/coding-agent/src/composition/greenfield-runtime-composition.ts: retired migration reference (createGreenfieldRuntimeComposition)",
			"packages/coding-agent/src/composition/greenfield-runtime-composition.ts: retired migration reference (GreenfieldRuntimeComposition)",
			"compositionGreenfieldFiles: 1 exceeds migration residue limit 0",
		]);
	});

	it("rejects retired Composition public seam identities", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/composition/greenfield-runtime-host-session-backend.ts",
				text: [
					'import { resolveGreenfieldSessionIdFromPath } from "./greenfield-conversation-path.js";',
					"export class GreenfieldRuntimeHostSessionBackend {}",
				].join("\n"),
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/composition/greenfield-runtime-host-session-backend.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/composition/greenfield-runtime-host-session-backend.ts: retired migration reference (greenfield-conversation-path)",
			"packages/coding-agent/src/composition/greenfield-runtime-host-session-backend.ts: retired migration reference (resolveGreenfieldSessionIdFromPath)",
			"packages/coding-agent/src/composition/greenfield-runtime-host-session-backend.ts: retired migration reference (GreenfieldRuntimeHostSessionBackend)",
			"compositionGreenfieldFiles: 1 exceeds migration residue limit 0",
		]);
	});

	it("rejects retired runtime-core barrels from production and tests", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/adapters/runtime-core/greenfield.ts",
				text: "export {};",
			},
			{
				path: "packages/coding-agent/src/composition/runtime-composition.ts",
				text: 'import "../adapters/runtime-core/greenfield.js";',
			},
			{
				path: "packages/coding-agent/test/runtime-core/runtime.test.ts",
				text: 'import "../../src/adapters/runtime-core/index.js";',
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/adapters/runtime-core/greenfield.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/composition/runtime-composition.ts: retired migration reference (adapters/runtime-core/greenfield.js)",
			"packages/coding-agent/test/runtime-core/runtime.test.ts: retired migration reference (adapters/runtime-core/index.js)",
		]);
	});

	it("rejects retired Session Host implementation paths", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/adapters/runtime-core/greenfield-turn-executor.ts",
				text: "export class CodingAgentGreenfieldTurnExecutor {}",
			},
			{
				path: "packages/coding-agent/src/host/session-execution/turn-executor.ts",
				text: 'import "../../adapters/runtime-core/greenfield-turn-retry-controller.js";',
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/adapters/runtime-core/greenfield-turn-executor.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/host/session-execution/turn-executor.ts: retired migration reference (adapters/runtime-core/greenfield-turn-retry-controller)",
		]);
	});

	it("rejects retired Extension Host ownership paths", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/adapters/runtime-core/greenfield-extension-event-host.ts",
				text: "export class CodingAgentGreenfieldExtensionEventHost {}",
			},
			{
				path: "packages/coding-agent/src/host/extensions/event-host.ts",
				text: 'import type { Contract } from "../../composition/session-host/extension-session-host.js";',
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/adapters/runtime-core/greenfield-extension-event-host.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/host/extensions/event-host.ts: retired migration reference (composition/session-host/extension-session-host)",
			"hostExtensionCompositionEdgeFiles: 1 exceeds migration residue limit 0",
		]);
	});

	it("rejects retired Session Host and protocol adapter ownership paths", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/adapters/runtime-core/greenfield-branch-navigation-host.ts",
				text: "export class CodingAgentGreenfieldBranchNavigationHost {}",
			},
			{
				path: "packages/coding-agent/src/host/session-history/branch-navigation-host.ts",
				text: 'import "../../adapters/runtime-core/greenfield-readonly-session-manager.js";',
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/adapters/runtime-core/greenfield-branch-navigation-host.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/host/session-history/branch-navigation-host.ts: retired migration reference (adapters/runtime-core/greenfield-readonly-session-manager)",
		]);
	});

	it("rejects retired Session initialization and lifecycle identities", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/composition/greenfield-session-execution-runtime.ts",
				text: "export class GreenfieldSessionExecutionRuntime {}",
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/composition/greenfield-session-execution-runtime.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/composition/greenfield-session-execution-runtime.ts: retired migration reference (GreenfieldSessionExecutionRuntime)",
			"compositionGreenfieldFiles: 1 exceeds migration residue limit 0",
		]);
	});

	it("rejects retired Tool Surface and Adapter policy identities", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/composition/greenfield-runtime-tool-surface.ts",
				text: "export function createGreenfieldRuntimeToolSurface() {}",
			},
			{
				path: "packages/coding-agent/src/adapters/runtime-core/greenfield-model-tool-order.ts",
				text: "export const order = {};",
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/adapters/runtime-core/greenfield-model-tool-order.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/composition/greenfield-runtime-tool-surface.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/composition/greenfield-runtime-tool-surface.ts: retired migration reference (createGreenfieldRuntimeToolSurface)",
			"compositionGreenfieldFiles: 1 exceeds migration residue limit 0",
		]);
	});

	it("rejects retired Subagent, Turn and Conversation Composition identities", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/composition/greenfield-subagent-runtime.ts",
				text: "export class GreenfieldSubagentRuntime {}",
			},
			{
				path: "packages/coding-agent/src/composition/runtime-composition.ts",
				text: [
					'import { createGreenfieldTurnCapabilitySessionAssembly } from "./greenfield-turn-capability-session-assembly.js";',
					"resolveGreenfieldConversationPersistence({});",
				].join("\n"),
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/composition/greenfield-subagent-runtime.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/composition/greenfield-subagent-runtime.ts: retired migration reference (GreenfieldSubagentRuntime)",
			"packages/coding-agent/src/composition/runtime-composition.ts: retired migration reference (greenfield-turn-capability-session-assembly)",
			"packages/coding-agent/src/composition/runtime-composition.ts: retired migration reference (createGreenfieldTurnCapabilitySessionAssembly)",
			"packages/coding-agent/src/composition/runtime-composition.ts: retired migration reference (resolveGreenfieldConversationPersistence)",
			"compositionGreenfieldFiles: 1 exceeds migration residue limit 0",
		]);
	});

	it("rejects retired model call and Prompt boundary identities", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/adapters/runtime-core/greenfield-prompt-adapter.ts",
				text: "export class CodingAgentGreenfieldPromptAdapter implements GreenfieldPromptAdapter {}",
			},
			{
				path: "packages/coding-agent/src/composition/runtime-composition.ts",
				text: [
					'import "../adapters/runtime-core/greenfield-model-call-composer.js";',
					'import "../adapters/runtime-core/greenfield-agent-message-context-projector.js";',
					"projectCodingAgentGreenfieldMessages(document);",
				].join("\n"),
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/adapters/runtime-core/greenfield-prompt-adapter.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/adapters/runtime-core/greenfield-prompt-adapter.ts: retired migration reference (CodingAgentGreenfieldPromptAdapter)",
			"packages/coding-agent/src/adapters/runtime-core/greenfield-prompt-adapter.ts: retired migration reference (GreenfieldPromptAdapter)",
			"packages/coding-agent/src/composition/runtime-composition.ts: retired migration reference (greenfield-model-call-composer)",
			"packages/coding-agent/src/composition/runtime-composition.ts: retired migration reference (greenfield-agent-message-context-projector)",
			"packages/coding-agent/src/composition/runtime-composition.ts: retired migration reference (projectCodingAgentGreenfieldMessages)",
		]);
	});

	it("rejects retired Extension, Plugin, Continuation and MCP adapter identities", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/adapters/runtime-core/greenfield-extension-event-bridge.ts",
				text: "export class CodingAgentGreenfieldExtensionEventBridge {}",
			},
			{
				path: "packages/coding-agent/src/composition/runtime-composition.ts",
				text: [
					'import "../adapters/runtime-core/greenfield-plugin-mcp-runtime.js";',
					'import "../adapters/runtime-core/coding-agent-mcp-supervisor.js";',
				].join("\n"),
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/adapters/runtime-core/greenfield-extension-event-bridge.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/adapters/runtime-core/greenfield-extension-event-bridge.ts: retired migration reference (CodingAgentGreenfieldExtensionEventBridge)",
			"packages/coding-agent/src/composition/runtime-composition.ts: retired migration reference (adapters/runtime-core/greenfield-plugin-mcp-runtime)",
			"packages/coding-agent/src/composition/runtime-composition.ts: retired migration reference (adapters/runtime-core/coding-agent-mcp-supervisor)",
		]);
	});

	it("rejects the retired product capability Adapter paths and symbols", () => {
		const state = collectCodingAgentMigrationResidue([
			{
				path: "packages/coding-agent/src/adapters/runtime-core/greenfield-mcp-deferred-adapter.ts",
				text: "export {};",
			},
			{
				path: "packages/coding-agent/src/composition/session-initialization/peripheral-assembly.ts",
				text: [
					'import "../../adapters/runtime-core/greenfield-product-tools-runtime.js";',
					"createCodingAgentGreenfieldProductToolRegistrations({});",
				].join("\n"),
			},
		]);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			"packages/coding-agent/src/adapters/runtime-core/greenfield-mcp-deferred-adapter.ts: retired migration file must stay deleted",
			"packages/coding-agent/src/composition/session-initialization/peripheral-assembly.ts: retired migration reference (adapters/runtime-core/greenfield-product-tools-runtime)",
			"packages/coding-agent/src/composition/session-initialization/peripheral-assembly.ts: retired migration reference (createCodingAgentGreenfieldProductToolRegistrations)",
		]);
	});

	it("rejects growth beyond each migration residue baseline", () => {
		const files = [
			...Array.from({ length: MIGRATION_RESIDUE_LIMITS.adapterGreenfieldFiles + 1 }, (_, index) => ({
				path: `packages/coding-agent/src/adapters/runtime-core/greenfield-adapter-${index}.ts`,
				text: "export {};",
			})),
			...Array.from({ length: MIGRATION_RESIDUE_LIMITS.cliGreenfieldFiles + 1 }, (_, index) => ({
				path: `packages/cli-app/src/rpc/greenfield-host-${index}.ts`,
				text: "export {};",
			})),
			...Array.from({ length: MIGRATION_RESIDUE_LIMITS.compositionGreenfieldFiles + 1 }, (_, index) => ({
				path: `packages/coding-agent/src/composition/greenfield-composition-${index}.ts`,
				text: "export {};",
			})),
			...Array.from({ length: MIGRATION_RESIDUE_LIMITS.adapterCompositionEdgeFiles + 1 }, (_, index) => ({
				path: `packages/coding-agent/src/adapters/runtime-core/adapter-edge-${index}.ts`,
				text: 'import type { Contract } from "../../composition/contracts.js";',
			})),
			...Array.from({ length: MIGRATION_RESIDUE_LIMITS.compositionPublicApiEdgeFiles + 1 }, (_, index) => ({
				path: `packages/coding-agent/src/composition/public-api-edge-${index}.ts`,
				text: 'import type { Contract } from "../public-api/runtime.js";',
			})),
			...Array.from({ length: MIGRATION_RESIDUE_LIMITS.hostExtensionCompositionEdgeFiles + 1 }, (_, index) => ({
				path: `packages/coding-agent/src/host/extensions/composition-edge-${index}.ts`,
				text: 'import type { Contract } from "../../composition/contracts.js";',
			})),
		];
		const state = collectCodingAgentMigrationResidue(files);

		expect(findCodingAgentMigrationResidueViolations(state)).toEqual([
			`adapterGreenfieldFiles: ${MIGRATION_RESIDUE_LIMITS.adapterGreenfieldFiles + 1} exceeds migration residue limit ${MIGRATION_RESIDUE_LIMITS.adapterGreenfieldFiles}`,
			`cliGreenfieldFiles: ${MIGRATION_RESIDUE_LIMITS.cliGreenfieldFiles + 1} exceeds migration residue limit ${MIGRATION_RESIDUE_LIMITS.cliGreenfieldFiles}`,
			`compositionGreenfieldFiles: ${MIGRATION_RESIDUE_LIMITS.compositionGreenfieldFiles + 1} exceeds migration residue limit ${MIGRATION_RESIDUE_LIMITS.compositionGreenfieldFiles}`,
			`adapterCompositionEdgeFiles: ${MIGRATION_RESIDUE_LIMITS.adapterCompositionEdgeFiles + 1} exceeds migration residue limit ${MIGRATION_RESIDUE_LIMITS.adapterCompositionEdgeFiles}`,
			`compositionPublicApiEdgeFiles: ${MIGRATION_RESIDUE_LIMITS.compositionPublicApiEdgeFiles + 1} exceeds migration residue limit ${MIGRATION_RESIDUE_LIMITS.compositionPublicApiEdgeFiles}`,
			`hostExtensionCompositionEdgeFiles: ${MIGRATION_RESIDUE_LIMITS.hostExtensionCompositionEdgeFiles + 1} exceeds migration residue limit ${MIGRATION_RESIDUE_LIMITS.hostExtensionCompositionEdgeFiles}`,
		]);
	});
});
