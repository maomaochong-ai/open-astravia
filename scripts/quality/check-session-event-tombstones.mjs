/**
 * Keep retired Runtime SessionEvent types out of the codebase.
 *
 * Removing an event type from the contract lets the compiler flag every typed
 * consumer, but tests and adapters that cast (`as never`, local event unions)
 * slip past it and keep a protocol alive that nothing produces. A retired type
 * is listed here once; any later mention fails the guard, so a dead branch
 * cannot come back and hide behind a passing test.
 *
 * Producers of the live contract are checked by
 * packages/runtime-core/test/session-event-producers.test.ts.
 */

import { join } from "node:path";
import { fail, isDirectRun, ok, readText, rel, repoRoot, walkFiles } from "./lib.mjs";

/** Retired event type → why it is gone. Never remove an entry. */
export const RETIRED_SESSION_EVENT_TYPES = Object.freeze({
	"message.delta": "replaced by assistant-channel text_delta (ADR-0146)",
	"thinking.delta": "replaced by assistant-channel thinking_delta (ADR-0146)",
	"message.final": "replaced by assistant-channel done/error (ADR-0146)",
	"toolcall.start": "replaced by assistant-channel toolcall_start (ADR-0146)",
	"toolcall.args": "replaced by assistant-channel toolcall_delta/toolcall_end (ADR-0146)",
});

const SOURCE_DIRECTORIES = Object.freeze(["apps", "packages"]);
const EXTENSIONS = Object.freeze([".ts", ".tsx", ".js", ".mjs", ".cjs", ".swift", ".kt"]);
const SELF = new Set([
	"scripts/quality/check-session-event-tombstones.mjs",
	"scripts/quality/session-event-tombstones.test.mjs",
]);

function quotedPattern(type) {
	const escaped = type.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	return new RegExp(`["'\`]${escaped}["'\`]`, "u");
}

const PATTERNS = Object.entries(RETIRED_SESSION_EVENT_TYPES).map(([type, reason]) => ({
	type,
	reason,
	pattern: quotedPattern(type),
}));

export function findSessionEventTombstoneViolations(files) {
	const violations = [];
	for (const file of files) {
		if (SELF.has(file.path)) continue;
		for (const [index, line] of file.text.split(/\r?\n/u).entries()) {
			for (const { type, reason, pattern } of PATTERNS) {
				if (pattern.test(line))
					violations.push(`${file.path}:${index + 1}: retired SessionEvent "${type}" — ${reason}`);
			}
		}
	}
	return violations;
}

function collectFiles(selected) {
	const paths =
		selected.length > 0
			? selected
					.map((file) => file.replaceAll("\\", "/"))
					.filter((file) => EXTENSIONS.some((extension) => file.endsWith(extension)))
					.map((file) => join(repoRoot, file))
			: SOURCE_DIRECTORIES.flatMap((directory) =>
					walkFiles(join(repoRoot, directory), { extensions: [...EXTENSIONS] }),
				);
	return paths.map((filePath) => {
		try {
			return { path: rel(filePath), text: readText(filePath) };
		} catch {
			return { path: rel(filePath), text: "" };
		}
	});
}

if (isDirectRun(import.meta.url)) {
	const files = collectFiles(process.argv.slice(2));
	const violations = findSessionEventTombstoneViolations(files);
	if (violations.length > 0) {
		for (const violation of violations) fail(`[session-event-tombstones] ${violation}`);
	} else {
		ok(`[session-event-tombstones] ok (${files.length} source files)`);
	}
}
