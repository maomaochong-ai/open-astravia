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

	it("rejects growth beyond each migration residue baseline", () => {
		const files = [
			...Array.from({ length: MIGRATION_RESIDUE_LIMITS.adapterGreenfieldFiles + 1 }, (_, index) => ({
				path: `packages/coding-agent/src/adapters/runtime-core/greenfield-adapter-${index}.ts`,
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
			`compositionGreenfieldFiles: ${MIGRATION_RESIDUE_LIMITS.compositionGreenfieldFiles + 1} exceeds migration residue limit ${MIGRATION_RESIDUE_LIMITS.compositionGreenfieldFiles}`,
			`adapterCompositionEdgeFiles: ${MIGRATION_RESIDUE_LIMITS.adapterCompositionEdgeFiles + 1} exceeds migration residue limit ${MIGRATION_RESIDUE_LIMITS.adapterCompositionEdgeFiles}`,
			`compositionPublicApiEdgeFiles: ${MIGRATION_RESIDUE_LIMITS.compositionPublicApiEdgeFiles + 1} exceeds migration residue limit ${MIGRATION_RESIDUE_LIMITS.compositionPublicApiEdgeFiles}`,
			`hostExtensionCompositionEdgeFiles: ${MIGRATION_RESIDUE_LIMITS.hostExtensionCompositionEdgeFiles + 1} exceeds migration residue limit ${MIGRATION_RESIDUE_LIMITS.hostExtensionCompositionEdgeFiles}`,
		]);
	});
});
