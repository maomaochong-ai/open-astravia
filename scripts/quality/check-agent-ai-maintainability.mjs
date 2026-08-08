/** Keep Agent orchestration and AI provider facades aligned with their responsibility boundaries. */

import { join } from "node:path";
import ts from "typescript";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

const FACADE_FILES = Object.freeze([
	"packages/ai/src/providers/amazon-bedrock.ts",
	"packages/ai/src/providers/anthropic.ts",
	"packages/ai/src/providers/google-gemini-cli.ts",
	"packages/ai/src/providers/openai-codex-responses.ts",
	"packages/ai/src/providers/openai-completions.ts",
	"packages/ai/src/providers/openai-responses-shared.ts",
]);

const REQUIRED_OWNER_FILES = Object.freeze([
	"packages/agent/src/loop/assistant-stream.ts",
	"packages/agent/src/loop/context-checkpoint.ts",
	"packages/agent/src/loop/telemetry.ts",
	"packages/agent/src/loop/tool-execution.ts",
	"packages/agent/src/runtime/message-queue.ts",
	"packages/agent/src/runtime/state-projection.ts",
	"packages/ai/src/providers/amazon-bedrock/client.ts",
	"packages/ai/src/providers/amazon-bedrock/events.ts",
	"packages/ai/src/providers/amazon-bedrock/messages.ts",
	"packages/ai/src/providers/amazon-bedrock/request.ts",
	"packages/ai/src/providers/amazon-bedrock/stream.ts",
	"packages/ai/src/providers/anthropic/client.ts",
	"packages/ai/src/providers/anthropic/messages.ts",
	"packages/ai/src/providers/anthropic/request.ts",
	"packages/ai/src/providers/anthropic/stream.ts",
	"packages/ai/src/providers/google-gemini-cli/request.ts",
	"packages/ai/src/providers/google-gemini-cli/response.ts",
	"packages/ai/src/providers/google-gemini-cli/retry.ts",
	"packages/ai/src/providers/google-gemini-cli/stream.ts",
	"packages/ai/src/providers/openai-codex/events.ts",
	"packages/ai/src/providers/openai-codex/request.ts",
	"packages/ai/src/providers/openai-codex/stream.ts",
	"packages/ai/src/providers/openai-codex/websocket.ts",
	"packages/ai/src/providers/openai-completions/messages.ts",
	"packages/ai/src/providers/openai-completions/request.ts",
	"packages/ai/src/providers/openai-completions/stream.ts",
	"packages/ai/src/providers/openai-responses/events.ts",
	"packages/ai/src/providers/openai-responses/messages.ts",
]);

const REQUIRED_AGENT_LOOP_IMPORTS = Object.freeze([
	"./loop/assistant-stream.js",
	"./loop/context-checkpoint.js",
	"./loop/telemetry.js",
	"./loop/tool-execution.js",
]);

export function findAgentAiMaintainabilityViolations(files) {
	const violations = [];
	const byPath = new Map(files.map((file) => [file.path.replaceAll("\\", "/"), file.text]));
	for (const path of REQUIRED_OWNER_FILES) {
		if (!byPath.has(path)) violations.push(`${path}: required responsibility owner is missing`);
	}
	for (const path of FACADE_FILES) {
		const text = byPath.get(path);
		if (text === undefined) {
			violations.push(`${path}: provider facade is missing`);
			continue;
		}
		const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
		for (const statement of source.statements) {
			if (!ts.isExportDeclaration(statement)) {
				violations.push(`${path}: provider facade may only contain export declarations`);
				break;
			}
			const target = statement.moduleSpecifier;
			if (!target || !ts.isStringLiteral(target) || !target.text.startsWith("./")) {
				violations.push(`${path}: provider facade exports must target relative internal modules`);
				break;
			}
		}
	}

	const agentLoopPath = "packages/agent/src/agent-loop.ts";
	const agentLoopText = byPath.get(agentLoopPath);
	if (agentLoopText === undefined) {
		violations.push(`${agentLoopPath}: Agent loop entry is missing`);
	} else {
		const source = ts.createSourceFile(agentLoopPath, agentLoopText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
		const imports = new Set(
			source.statements
				.filter(ts.isImportDeclaration)
				.map((statement) => statement.moduleSpecifier)
				.filter(ts.isStringLiteral)
				.map((specifier) => specifier.text),
		);
		for (const requiredImport of REQUIRED_AGENT_LOOP_IMPORTS) {
			if (!imports.has(requiredImport)) {
				violations.push(`${agentLoopPath}: missing responsibility delegation import ${requiredImport}`);
			}
		}
	}

	for (const [path, text] of byPath) {
		if (!path.startsWith("packages/agent/src/") && !path.startsWith("packages/ai/src/")) continue;
		if (/typeof\s+import\s*\(/u.test(text)) {
			violations.push(`${path}: inline import type is forbidden; use a top-level import type`);
		}
	}
	return violations;
}

export function collectAgentAiMaintainabilityInput() {
	return ["packages/agent/src", "packages/ai/src"].flatMap((directory) =>
		walkFiles(join(repoRoot, directory), { extensions: [".ts"] }).map((filePath) => ({
			path: rel(filePath),
			text: readText(filePath),
		})),
	);
}

if (isDirectRun(import.meta.url)) {
	const files = collectAgentAiMaintainabilityInput();
	const violations = findAgentAiMaintainabilityViolations(files);
	if (violations.length > 0) {
		for (const violation of violations) fail(`[agent-ai-maintainability] ${violation}`);
	} else {
		ok(
			`[agent-ai-maintainability] ok (${FACADE_FILES.length} facades, ${REQUIRED_OWNER_FILES.length} responsibility owners, inline type imports=0)`,
		);
	}
}
