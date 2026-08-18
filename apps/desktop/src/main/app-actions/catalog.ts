import { getAppLogger } from "../logger.js";
import { searchActions } from "./search.js";
import type { ActionDefinition, ActionMetadata, ActionSearchResult } from "./types.js";
import { ActionError } from "./types.js";

const log = getAppLogger("action-catalog");

export interface AppActionProviderOptions {
	providerId: string;
}

export interface AppActionCatalogOptions {
	requiredProviderPrefixes?: readonly string[];
}

interface AppActionEntry extends AppActionProviderOptions {
	action: ActionDefinition;
}

/**
 * App Action 目录：每个 action id 仅保留一份实现。
 * 冲突策略：先注册为准，后到者打日志并忽略（返回 no-op unregister）。
 */
export class AppActionCatalog {
	private entries = new Map<string, AppActionEntry>();

	constructor(private readonly options: AppActionCatalogOptions = {}) {}

	register(action: ActionDefinition, options: AppActionProviderOptions): () => void {
		return this.registerProvider([action], options).get(action.id)!;
	}

	registerProvider(
		actions: readonly ActionDefinition[],
		options: AppActionProviderOptions,
	): ReadonlyMap<string, () => void> {
		const actionIds = actions.map((action) => action.id);
		if (new Set(actionIds).size !== actionIds.length) {
			throw new ActionError(
				"ACTION_DUPLICATE",
				`Action provider contains duplicate action ids: ${options.providerId}`,
			);
		}
		for (const action of actions) {
			this.validateAction(action);
		}

		const unregisterByActionId = new Map<string, () => void>();
		for (const action of actions) {
			const existing = this.entries.get(action.id);
			if (existing) {
				log.warn("register: action id conflict, keeping first registration", {
					actionId: action.id,
					domain: action.domain,
					existingProviderId: existing.providerId,
					existingTitle: existing.action.title,
					rejectedProviderId: options.providerId,
					rejectedTitle: action.title,
				});
				unregisterByActionId.set(action.id, () => {
					/* conflict loser: nothing to unregister from catalog */
				});
				continue;
			}

			const entry: AppActionEntry = { action, providerId: options.providerId };
			this.entries.set(action.id, entry);
			unregisterByActionId.set(action.id, this.createUnregister(entry));
			log.info("register: success", {
				actionId: action.id,
				domain: action.domain,
				providerId: options.providerId,
				availability: action.availability,
				permission: action.permission,
				requiresApproval: action.requiresApproval !== undefined,
				registeredCount: this.entries.size,
			});
		}
		return unregisterByActionId;
	}

	/**
	 * 原子替换一个 provider 的完整 Action 集合。
	 *
	 * 所有新 Action 会先完成校验，并在 Catalog 快照中解析冲突；只有整个过程
	 * 成功后才一次性发布。热更新失败时，旧 provider 仍保持可用。
	 */
	replaceProvider(
		actions: readonly ActionDefinition[],
		options: AppActionProviderOptions,
		previousProviderId?: string,
	): ReadonlyMap<string, () => void> {
		const actionIds = actions.map((action) => action.id);
		if (new Set(actionIds).size !== actionIds.length) {
			throw new ActionError(
				"ACTION_DUPLICATE",
				`Action provider contains duplicate action ids: ${options.providerId}`,
			);
		}
		for (const action of actions) this.validateAction(action);

		const nextEntries = new Map(this.entries);
		if (previousProviderId) {
			for (const [actionId, entry] of nextEntries) {
				if (entry.providerId === previousProviderId) nextEntries.delete(actionId);
			}
		}

		const acceptedEntries = new Map<string, AppActionEntry>();
		for (const action of actions) {
			const existing = nextEntries.get(action.id);
			if (existing) {
				log.warn("replace: action id conflict, keeping existing registration", {
					actionId: action.id,
					domain: action.domain,
					existingProviderId: existing.providerId,
					existingTitle: existing.action.title,
					rejectedProviderId: options.providerId,
					rejectedTitle: action.title,
				});
				continue;
			}
			const entry: AppActionEntry = { action, providerId: options.providerId };
			nextEntries.set(action.id, entry);
			acceptedEntries.set(action.id, entry);
		}

		this.entries = nextEntries;
		const unregisterByActionId = new Map<string, () => void>();
		for (const action of actions) {
			const entry = acceptedEntries.get(action.id);
			unregisterByActionId.set(
				action.id,
				entry
					? this.createUnregister(entry)
					: () => {
							/* conflict loser: nothing to unregister from catalog */
						},
			);
		}
		log.info("replace: provider committed", {
			providerId: options.providerId,
			previousProviderId,
			actionCount: actions.length,
			acceptedCount: acceptedEntries.size,
			registeredCount: this.entries.size,
		});
		return unregisterByActionId;
	}

	assertReady(): void {
		for (const prefix of this.options.requiredProviderPrefixes ?? []) {
			if ([...this.entries.values()].some((entry) => entry.providerId.startsWith(prefix))) continue;
			throw new ActionError("ACTION_RUNTIME_NOT_READY", "Required App Action provider is not ready.", {
				requiredProviderPrefix: prefix,
			});
		}
	}

	private validateAction(action: ActionDefinition): void {
		if (action.requiresApproval && !action.approval) {
			log.error("register: missing approval metadata", { actionId: action.id, domain: action.domain });
			throw new ActionError(
				"ACTION_APPROVAL_CONFIG_INVALID",
				`Action requires approval but has no approval UI configured: ${action.id}`,
			);
		}
		if (action.approval) {
			const presentationIds = action.approval.presentations.map((presentation) => presentation.id);
			if (new Set(presentationIds).size !== presentationIds.length) {
				log.error("register: duplicate approval presentation ids", {
					actionId: action.id,
					domain: action.domain,
					presentationIds,
				});
				throw new ActionError(
					"ACTION_APPROVAL_CONFIG_INVALID",
					`Action has duplicate approval UI ids: ${action.id}`,
				);
			}
			if (!presentationIds.includes(action.approval.defaultPresentation)) {
				log.error("register: default approval presentation is not declared", {
					actionId: action.id,
					domain: action.domain,
					defaultPresentation: action.approval.defaultPresentation,
					presentationIds,
				});
				throw new ActionError(
					"ACTION_APPROVAL_CONFIG_INVALID",
					`Action default approval UI is not declared: ${action.id}`,
				);
			}
		}
	}

	private createUnregister(entry: AppActionEntry): () => void {
		let registered = true;
		return () => {
			if (!registered) return;
			registered = false;
			const current = this.entries.get(entry.action.id);
			if (current !== entry) return;
			this.entries.delete(entry.action.id);
			log.info("unregister: success", {
				actionId: entry.action.id,
				domain: entry.action.domain,
				providerId: entry.providerId,
				registeredCount: this.entries.size,
			});
		};
	}

	private getActiveAction(actionId: string): ActionDefinition | undefined {
		return this.entries.get(actionId)?.action;
	}

	private *getActiveActions(): IterableIterator<ActionDefinition> {
		for (const entry of this.entries.values()) {
			yield entry.action;
		}
	}

	search(options: { query?: string; domain?: string } = {}): ActionSearchResult[] {
		this.assertReady();
		const results = searchActions(this.getActiveActions(), options);
		log.info("search: result", {
			query: options.query?.trim() ?? "",
			domain: options.domain?.trim(),
			resultCount: results.length,
			actionIds: results.map((action) => action.id),
		});
		return results;
	}

	describe(actionId: string): ActionMetadata {
		this.assertReady();
		const action = this.getActiveAction(actionId);
		if (!action) {
			throw new ActionError("ACTION_NOT_FOUND", `Action not found: ${actionId}`);
		}
		return {
			id: action.id,
			domain: action.domain,
			title: action.title,
			summary: action.summary,
			availability: action.availability,
			permission: action.permission,
			keywords: action.keywords,
			approval: action.approval,
			inputSchema: action.inputSchema,
			examples: action.examples,
		};
	}

	get(actionId: string): ActionDefinition {
		this.assertReady();
		const action = this.getActiveAction(actionId);
		if (!action) {
			throw new ActionError("ACTION_NOT_FOUND", `Action not found: ${actionId}`);
		}
		return action;
	}
}
