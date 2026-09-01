import { CONTENT_AGENT_OPERATION_SCHEMA } from "../../agent/operations";
import {
	CONTENT_ASSETS_INPUT_SCHEMA,
	CONTENT_ASSETS_OPERATION_DESCRIPTION,
} from "./assets";
import {
	CONTENT_EDIT_OPERATION_DESCRIPTION,
} from "./edit";
import {
	CONTENT_INSPECT_INPUT_SCHEMA,
	CONTENT_INSPECT_OPERATION_DESCRIPTION,
} from "./inspect";
import {
	CONTENT_RUN_INPUT_SCHEMA,
	CONTENT_RUN_OPERATION_DESCRIPTION,
} from "./run";

export const CONTENT_EXECUTION_OPERATIONS = ["inspect", "assets", "edit", "run"] as const;

export type ContentExecutionOperation = (typeof CONTENT_EXECUTION_OPERATIONS)[number];

export interface ContentOperationCatalogEntry {
	id: string;
	executeOperation: ContentExecutionOperation;
	summary: string;
	inputPlacement: "input" | "input.operations[]";
	inputSchema?: object;
}

const EDIT_OPERATION_ENTRIES: readonly ContentOperationCatalogEntry[] =
	CONTENT_AGENT_OPERATION_SCHEMA.items.oneOf.map((schema) => ({
		id: `edit.${String(schema.properties.type.const)}`,
		executeOperation: "edit",
		summary: schema.description,
		inputPlacement: "input.operations[]",
		inputSchema: schema,
	}));

export const CONTENT_OPERATION_CATALOG: readonly ContentOperationCatalogEntry[] = [
	{
		id: "inspect",
		executeOperation: "inspect",
		summary: CONTENT_INSPECT_OPERATION_DESCRIPTION,
		inputPlacement: "input",
		inputSchema: CONTENT_INSPECT_INPUT_SCHEMA,
	},
	{
		id: "assets",
		executeOperation: "assets",
		summary: CONTENT_ASSETS_OPERATION_DESCRIPTION,
		inputPlacement: "input",
		inputSchema: CONTENT_ASSETS_INPUT_SCHEMA,
	},
	{
		id: "edit",
		executeOperation: "edit",
		summary: `${CONTENT_EDIT_OPERATION_DESCRIPTION} Search for edit.<operation-type> entries and place one or more returned variants in input.operations.`,
		inputPlacement: "input.operations[]",
	},
	...EDIT_OPERATION_ENTRIES,
	{
		id: "run",
		executeOperation: "run",
		summary: CONTENT_RUN_OPERATION_DESCRIPTION,
		inputPlacement: "input",
		inputSchema: CONTENT_RUN_INPUT_SCHEMA,
	},
];

const CATALOG_BY_ID = new Map(CONTENT_OPERATION_CATALOG.map((entry) => [entry.id, entry]));

export function findContentOperation(id: string): ContentOperationCatalogEntry | undefined {
	return CATALOG_BY_ID.get(id);
}

export function searchContentOperations(query: string, limit: number): ContentOperationCatalogEntry[] {
	const terms = tokenize(query);
	if (terms.length === 0) return [];
	return CONTENT_OPERATION_CATALOG
		.map((entry, index) => ({ entry, index, score: scoreEntry(entry, terms) }))
		.filter((candidate) => candidate.score > 0)
		.sort((left, right) => right.score - left.score || left.index - right.index)
		.slice(0, limit)
		.map(({ entry }) => entry);
}

function scoreEntry(entry: ContentOperationCatalogEntry, terms: readonly string[]): number {
	const id = entry.id.toLowerCase();
	const searchable = `${id} ${entry.summary}`.toLowerCase();
	let score = 0;
	for (const term of terms) {
		if (id === term) score += 20;
		else if (id.includes(term)) score += 8;
		if (searchable.includes(term)) score += 2;
	}
	return score;
}

function tokenize(value: string): string[] {
	return value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
}
