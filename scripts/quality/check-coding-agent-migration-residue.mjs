/** Prevent retired Coding Agent migration seams from returning while reporting remaining cleanup debt. */

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

const SOURCE_ROOT = "packages/coding-agent/src";
const ADAPTER_ROOT = `${SOURCE_ROOT}/adapters`;
const COMPOSITION_ROOT = `${SOURCE_ROOT}/composition`;

export const MIGRATION_RESIDUE_LIMITS = Object.freeze({
	adapterGreenfieldFiles: 47,
	compositionGreenfieldFiles: 34,
	adapterCompositionEdgeFiles: 5,
});

export const RETIRED_MIGRATION_FILES = Object.freeze([`${ADAPTER_ROOT}/runtime-core/greenfield-tool-adapter.ts`]);

const RETIRED_MIGRATION_REFERENCES = Object.freeze([
	"adaptCodingAgentToolRegistration",
	"LegacyCodingAgentTool",
	"greenfield-tool-adapter",
]);

export function collectCodingAgentMigrationResidue(files) {
	const sourceFiles = files.filter((file) => file.path.startsWith(`${SOURCE_ROOT}/`));
	const adapterFiles = sourceFiles.filter((file) => file.path.startsWith(`${ADAPTER_ROOT}/`));
	const compositionFiles = sourceFiles.filter((file) => file.path.startsWith(`${COMPOSITION_ROOT}/`));
	return Object.freeze({
		retiredFiles: RETIRED_MIGRATION_FILES.filter((path) => sourceFiles.some((file) => file.path === path)),
		retiredReferences: sourceFiles.flatMap((file) =>
			RETIRED_MIGRATION_REFERENCES.filter((reference) => file.text.includes(reference)).map((reference) => ({
				path: file.path,
				reference,
			})),
		),
		adapterGreenfieldFiles: adapterFiles.filter((file) => basename(file.path).startsWith("greenfield")),
		compositionGreenfieldFiles: compositionFiles.filter((file) => basename(file.path).startsWith("greenfield")),
		adapterCompositionEdgeFiles: adapterFiles.filter((file) =>
			collectModuleSpecifiers(file.text).some((specifier) => specifier.includes("composition/")),
		),
	});
}

export function findCodingAgentMigrationResidueViolations(state) {
	const violations = [];
	for (const path of state.retiredFiles) violations.push(`${path}: retired migration file must stay deleted`);
	for (const reference of state.retiredReferences) {
		violations.push(`${reference.path}: retired migration reference (${reference.reference})`);
	}
	for (const key of Object.keys(MIGRATION_RESIDUE_LIMITS)) {
		const actual = state[key].length;
		const limit = MIGRATION_RESIDUE_LIMITS[key];
		if (actual > limit) violations.push(`${key}: ${actual} exceeds migration residue limit ${limit}`);
	}
	return violations;
}

function collectModuleSpecifiers(text) {
	const specifiers = [];
	const pattern = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
	for (const match of text.matchAll(pattern)) specifiers.push(match[1]);
	return specifiers;
}

function readCurrentFiles() {
	return walkFiles(join(repoRoot, SOURCE_ROOT), { extensions: [".ts"] }).map((filePath) => ({
		path: rel(filePath),
		text: readText(filePath),
	}));
}

if (isDirectRun(import.meta.url)) {
	const missingRoots = [SOURCE_ROOT, ADAPTER_ROOT, COMPOSITION_ROOT].filter(
		(path) => !existsSync(join(repoRoot, path)),
	);
	if (missingRoots.length > 0) {
		for (const path of missingRoots) fail(`[coding-agent-migration-residue] missing source root (${path})`);
	} else {
		const state = collectCodingAgentMigrationResidue(readCurrentFiles());
		const violations = findCodingAgentMigrationResidueViolations(state);
		if (violations.length > 0) {
			for (const violation of violations) fail(`[coding-agent-migration-residue] ${violation}`);
		} else {
			ok(
				`[coding-agent-migration-residue] ok (retired files=${state.retiredFiles.length}/0, retired references=${state.retiredReferences.length}/0, Adapter greenfield files=${state.adapterGreenfieldFiles.length}/${MIGRATION_RESIDUE_LIMITS.adapterGreenfieldFiles}, Composition greenfield files=${state.compositionGreenfieldFiles.length}/${MIGRATION_RESIDUE_LIMITS.compositionGreenfieldFiles}, Adapter->Composition edge files=${state.adapterCompositionEdgeFiles.length}/${MIGRATION_RESIDUE_LIMITS.adapterCompositionEdgeFiles})`,
			);
		}
	}
}
