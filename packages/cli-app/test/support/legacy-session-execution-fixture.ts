import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const LEGACY_EXECUTION_MARKERS = {
	abandonedBranch: "legacy abandoned branch detail",
	branchSummary: "legacy branch summary",
	compactionSummary: "legacy compaction summary",
	hiddenBash: "legacy hidden bash output",
	hiddenCustom: "legacy hidden custom context",
	pruned: "legacy pruned before compaction",
	tail: "legacy tail after compaction",
	visibleBash: "legacy visible bash output",
	visibleCustom: "legacy visible custom context",
} as const;

interface LegacyExecutionFixtureLocation {
	readonly conversationDir: string;
	readonly root: string;
	readonly workspace: string;
}

export interface LegacyExecutionSessionFixture {
	readonly content: string;
	readonly sourcePath: string;
}

export interface LegacyExecutionContextObservation {
	readonly call: number;
	readonly identities: readonly string[];
	readonly observed: string;
}

export interface LegacyExecutionContextExtension {
	readonly observationPath: string;
	readonly path: string;
}

export async function writeLegacyExecutionSessionFixture(
	fixture: LegacyExecutionFixtureLocation,
): Promise<LegacyExecutionSessionFixture> {
	const sourcePath = join(fixture.conversationDir, "legacy-execution-source.jsonl");
	const content = jsonLines([
		{
			type: "session",
			version: 3,
			id: "legacy-execution-source",
			timestamp: "2026-01-01T00:00:00.000Z",
			cwd: fixture.workspace,
		},
		legacyMessage("legacy-pruned", null, 1, {
			role: "user",
			content: LEGACY_EXECUTION_MARKERS.pruned,
			timestamp: 1,
		}),
		legacyMessage("legacy-bash-visible", "legacy-pruned", 2, {
			role: "bashExecution",
			command: "legacy-visible-command",
			output: LEGACY_EXECUTION_MARKERS.visibleBash,
			exitCode: 0,
			cancelled: false,
			truncated: false,
			timestamp: 2,
		}),
		legacyMessage("legacy-bash-hidden", "legacy-bash-visible", 3, {
			role: "bashExecution",
			command: "legacy-hidden-command",
			output: LEGACY_EXECUTION_MARKERS.hiddenBash,
			exitCode: 0,
			cancelled: false,
			truncated: false,
			excludeFromContext: true,
			timestamp: 3,
		}),
		legacyEntry("custom_message", "legacy-custom-visible", "legacy-bash-hidden", 4, {
			customType: "legacy-visible-context",
			content: LEGACY_EXECUTION_MARKERS.visibleCustom,
			display: false,
		}),
		legacyEntry("custom_message", "legacy-custom-hidden", "legacy-custom-visible", 5, {
			customType: "prompt_resource_reference",
			content: LEGACY_EXECUTION_MARKERS.hiddenCustom,
			display: false,
		}),
		legacyMessage("legacy-abandoned-branch", "legacy-custom-hidden", 6, {
			role: "user",
			content: LEGACY_EXECUTION_MARKERS.abandonedBranch,
			timestamp: 6,
		}),
		legacyEntry("branch_summary", "legacy-branch-summary", "legacy-custom-hidden", 7, {
			fromId: "legacy-abandoned-branch",
			summary: LEGACY_EXECUTION_MARKERS.branchSummary,
		}),
		legacyEntry("compaction", "legacy-compaction", "legacy-branch-summary", 8, {
			summary: LEGACY_EXECUTION_MARKERS.compactionSummary,
			firstKeptEntryId: "legacy-bash-visible",
			tokensBefore: 100,
		}),
		legacyMessage("legacy-tail", "legacy-compaction", 9, {
			role: "user",
			content: LEGACY_EXECUTION_MARKERS.tail,
			timestamp: 9,
		}),
	]);
	await writeFile(sourcePath, content, "utf8");
	return { content, sourcePath };
}

export async function writeLegacyExecutionContextExtension(
	fixture: Pick<LegacyExecutionFixtureLocation, "root">,
): Promise<LegacyExecutionContextExtension> {
	const path = join(fixture.root, "legacy-execution-context-extension.ts");
	const observationPath = join(fixture.root, "legacy-execution-context-observations.jsonl");
	await writeFile(
		path,
		`import { appendFileSync } from "node:fs";
		const observationPath = ${JSON.stringify(observationPath)};
		export default function(extension) {
			let contextCalls = 0;
			extension.on("context", async (event) => {
				contextCalls += 1;
				const identities = event.messages.map((message) => {
					if (message.role === "custom") return "custom:" + message.customType;
					return message.role;
				});
				const observed = event.messages.flatMap((message) => {
					if (message.role === "bashExecution") return [message.command, message.output];
					if (message.role === "branchSummary" || message.role === "compactionSummary") return [message.summary];
					if (typeof message.content === "string") return [message.content];
					if (!Array.isArray(message.content)) return [];
					return message.content.filter((item) => item.type === "text").map((item) => item.text);
				}).join("|");
				appendFileSync(observationPath, JSON.stringify({ call: contextCalls, identities, observed }) + "\\n", "utf8");
				return {
					messages: [
						...event.messages,
						{
							role: "custom",
							customType: "legacy-execution-transient",
							content: "legacy-context-call:" + contextCalls + ";identities:" + identities.join(","),
							display: false,
							timestamp: contextCalls,
						},
					],
				};
			});
		}`,
		"utf8",
	);
	return { observationPath, path };
}

export async function readLegacyExecutionContextObservations(
	extension: LegacyExecutionContextExtension,
): Promise<readonly LegacyExecutionContextObservation[]> {
	const content = await readFile(extension.observationPath, "utf8");
	return content
		.trim()
		.split(/\r?\n/u)
		.filter(Boolean)
		.map((line) => parseContextObservation(JSON.parse(line) as unknown));
}

function legacyMessage(
	id: string,
	parentId: string | null,
	second: number,
	message: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return legacyEntry("message", id, parentId, second, { message });
}

function legacyEntry(
	type: string,
	id: string,
	parentId: string | null,
	second: number,
	fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return {
		type,
		id,
		parentId,
		timestamp: `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`,
		...fields,
	};
}

function jsonLines(records: readonly unknown[]): string {
	return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function parseContextObservation(value: unknown): LegacyExecutionContextObservation {
	if (typeof value !== "object" || value === null) throw new Error("Invalid Legacy execution context observation");
	const call = Reflect.get(value, "call");
	const identities = Reflect.get(value, "identities");
	const observed = Reflect.get(value, "observed");
	if (
		typeof call !== "number" ||
		!Array.isArray(identities) ||
		!identities.every((identity) => typeof identity === "string") ||
		typeof observed !== "string"
	) {
		throw new Error("Invalid Legacy execution context observation payload");
	}
	return { call, identities, observed };
}
