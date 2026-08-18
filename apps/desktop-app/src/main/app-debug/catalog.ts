import { getAppLogger } from "../logger.js";
import type { DebugDefinition, DebugMetadata, DebugSearchResult } from "./types.js";
import { DebugError } from "./types.js";

const log = getAppLogger("debug-catalog");

function normalize(value: string): string {
	return value.normalize("NFKC").toLowerCase().trim();
}

function matches(definition: DebugDefinition, query: string): boolean {
	if (!query) return true;
	return normalize(
		[definition.id, definition.category, definition.title, definition.summary, ...(definition.keywords ?? [])].join(
			"\n",
		),
	).includes(query);
}

export class AppDebugCatalog {
	private readonly definitions = new Map<string, DebugDefinition>();

	register(definition: DebugDefinition): void {
		if (this.definitions.has(definition.id)) {
			throw new DebugError("DEBUG_DUPLICATE", `Debug capability is already registered: ${definition.id}`);
		}
		this.definitions.set(definition.id, definition);
		log.info("register: success", {
			debugId: definition.id,
			category: definition.category,
			registeredCount: this.definitions.size,
		});
	}

	search(options: { query?: string; category?: string } = {}): DebugSearchResult[] {
		const query = normalize(options.query ?? "");
		const category = options.category?.trim();
		return Array.from(this.definitions.values())
			.filter((definition) => (!category || definition.category === category) && matches(definition, query))
			.map(({ id, title, summary, category: definitionCategory }) => ({
				id,
				category: definitionCategory,
				title,
				summary,
			}))
			.sort((a, b) => a.id.localeCompare(b.id));
	}

	describe(debugId: string): DebugMetadata {
		const definition = this.get(debugId);
		return {
			id: definition.id,
			category: definition.category,
			title: definition.title,
			summary: definition.summary,
			keywords: definition.keywords,
			inputSchema: definition.inputSchema,
			examples: definition.examples,
		};
	}

	get(debugId: string): DebugDefinition {
		const definition = this.definitions.get(debugId);
		if (!definition) {
			throw new DebugError("DEBUG_NOT_FOUND", `Debug capability not found: ${debugId}`);
		}
		return definition;
	}
}
