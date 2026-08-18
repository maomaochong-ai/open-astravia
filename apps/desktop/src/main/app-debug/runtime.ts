import { getAppLogger } from "../logger.js";
import type { AppDebugCatalog } from "./catalog.js";
import type { DebugContext, JsonValue } from "./types.js";

const log = getAppLogger("debug-runtime");

export class AppDebugRuntime {
	constructor(private readonly catalog: AppDebugCatalog) {}

	search(options: { query?: string; category?: string }): JsonValue {
		return this.catalog.search(options) as unknown as JsonValue;
	}

	describe(debugId: string): JsonValue {
		return this.catalog.describe(debugId) as unknown as JsonValue;
	}

	async run(debugId: string, input: unknown, context: DebugContext): Promise<JsonValue> {
		const startedAt = Date.now();
		const meta = { debugId, requestId: context.requestId };
		log.info("run: start", meta);
		try {
			const definition = this.catalog.get(debugId);
			const validatedInput = definition.validateInput(input);
			const result = await definition.run(validatedInput, context);
			log.info("run: success", meta, { durationMs: Date.now() - startedAt });
			return result;
		} catch (error) {
			log.error("run: failed", meta, { durationMs: Date.now() - startedAt }, error);
			throw error;
		}
	}
}
