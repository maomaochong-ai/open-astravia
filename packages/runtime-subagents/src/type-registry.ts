import type { SubagentTypeDefinition, SubagentTypeId, SubagentTypeRegistryLike } from "./contracts.js";

export class SubagentTypeRegistry<TProfile = unknown> implements SubagentTypeRegistryLike<TProfile> {
	private readonly types = new Map<SubagentTypeId, SubagentTypeDefinition<TProfile>>();

	register(definition: SubagentTypeDefinition<TProfile>): this {
		const id = definition.id.trim();
		if (!id) throw new Error("Subagent type id must be non-empty");
		if (this.types.has(id)) throw new Error(`Subagent type "${id}" is already registered`);
		this.types.set(id, definition);
		return this;
	}

	upsert(definition: SubagentTypeDefinition<TProfile>): this {
		const id = definition.id.trim();
		if (!id) throw new Error("Subagent type id must be non-empty");
		this.types.set(id, definition);
		return this;
	}

	get(id: SubagentTypeId): SubagentTypeDefinition<TProfile> | undefined {
		return this.types.get(id);
	}

	list(): readonly SubagentTypeDefinition<TProfile>[] {
		return [...this.types.values()];
	}

	ids(): readonly SubagentTypeId[] {
		return [...this.types.keys()];
	}
}
