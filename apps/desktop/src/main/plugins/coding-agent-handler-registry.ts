import type { AgentPluginRuntimeConfig, AgentPluginTurnHandlerLease } from "@vetta/runtime-core";

export type DesktopPluginAgentHandlerKind = "tool" | "continuation" | "system-prompt";

export interface DesktopPluginAgentHandlerReleasedEvent {
	readonly kind: DesktopPluginAgentHandlerKind;
	readonly pluginId: string;
	readonly handlerId: string;
	readonly activationId?: string;
}

interface HandlerGeneration extends DesktopPluginAgentHandlerReleasedEvent {
	activeLeases: number;
	retired: boolean;
	released: boolean;
	revokedReason?: string;
}

/** Owns renderer Agent handler generations independently from their future-Turn membership. */
export class DesktopPluginAgentHandlerRegistry {
	private readonly current = new Map<string, HandlerGeneration>();
	private readonly retired = new Set<HandlerGeneration>();
	private readonly releaseListeners = new Set<(event: DesktopPluginAgentHandlerReleasedEvent) => void>();

	register(event: DesktopPluginAgentHandlerReleasedEvent): void {
		const key = handlerKey(event.kind, event.pluginId, event.handlerId);
		const previous = this.current.get(key);
		this.current.set(key, { ...event, activeLeases: 0, retired: false, released: false });
		if (previous) this.retire(previous);
	}

	unregister(kind: DesktopPluginAgentHandlerKind, pluginId: string, handlerId: string): void {
		const key = handlerKey(kind, pluginId, handlerId);
		const generation = this.current.get(key);
		if (!generation) return;
		this.current.delete(key);
		this.retire(generation);
	}

	clear(pluginId: string): void {
		for (const [key, generation] of this.current) {
			if (generation.pluginId !== pluginId) continue;
			this.current.delete(key);
			this.retire(generation);
		}
	}

	acquire(config: AgentPluginRuntimeConfig | undefined): AgentPluginTurnHandlerLease {
		const generations = handlerReferences(config).map((reference) => {
			const current = this.current.get(handlerKey(reference.kind, reference.pluginId, reference.handlerId));
			const generation = [current, ...this.retired].find(
				(candidate) =>
					candidate?.kind === reference.kind &&
					candidate.pluginId === reference.pluginId &&
					candidate.handlerId === reference.handlerId &&
					candidate.activationId === reference.activationId,
			);
			if (!generation) {
				throw new Error(
					`Plugin ${reference.kind} handler is unavailable: ${reference.pluginId}/${reference.handlerId}`,
				);
			}
			if (generation.revokedReason) throw new Error(generation.revokedReason);
			return generation;
		});
		for (const generation of generations) generation.activeLeases += 1;
		let released = false;
		return {
			release: () => {
				if (released) return;
				released = true;
				for (const generation of generations) {
					generation.activeLeases -= 1;
					this.releaseIfUnused(generation);
				}
			},
		};
	}

	hardRevoke(
		pluginId: string,
		reason: string,
		kinds: ReadonlySet<DesktopPluginAgentHandlerKind | "hook"> = new Set(["tool", "continuation", "system-prompt"]),
	): number {
		let count = 0;
		for (const generation of [...this.current.values(), ...this.retired]) {
			if (generation.pluginId !== pluginId || !kinds.has(generation.kind) || generation.revokedReason !== undefined)
				continue;
			generation.revokedReason = reason;
			count += 1;
		}
		return count;
	}

	readInvocationRejection(
		kind: DesktopPluginAgentHandlerKind,
		pluginId: string,
		handlerId: string,
		activationId?: string,
	): string | undefined {
		const generation = [...this.current.values(), ...this.retired].find(
			(candidate) =>
				candidate.kind === kind &&
				candidate.pluginId === pluginId &&
				candidate.handlerId === handlerId &&
				candidate.activationId === activationId &&
				candidate.activeLeases > 0,
		);
		if (!generation) return "Plugin handler does not belong to an active Turn lease";
		return generation.revokedReason;
	}

	onReleased(listener: (event: DesktopPluginAgentHandlerReleasedEvent) => void): () => void {
		this.releaseListeners.add(listener);
		return () => this.releaseListeners.delete(listener);
	}

	releaseUnpublished(event: DesktopPluginAgentHandlerReleasedEvent): void {
		this.notifyReleased(event);
	}

	readLeaseDiagnostics(): { readonly retiredGenerations: number; readonly activeLeases: number } {
		return {
			retiredGenerations: this.retired.size,
			activeLeases: [...this.current.values(), ...this.retired].reduce(
				(total, generation) => total + generation.activeLeases,
				0,
			),
		};
	}

	private retire(generation: HandlerGeneration): void {
		if (generation.retired) return;
		generation.retired = true;
		this.retired.add(generation);
		this.releaseIfUnused(generation);
	}

	private releaseIfUnused(generation: HandlerGeneration): void {
		if (!generation.retired || generation.released || generation.activeLeases > 0) return;
		generation.released = true;
		this.retired.delete(generation);
		this.notifyReleased(generation);
	}

	private notifyReleased(event: DesktopPluginAgentHandlerReleasedEvent): void {
		for (const listener of this.releaseListeners) {
			try {
				listener(event);
			} catch {
				// Cleanup notification failures cannot roll registry retirement back.
			}
		}
	}
}

function handlerReferences(config: AgentPluginRuntimeConfig | undefined): DesktopPluginAgentHandlerReleasedEvent[] {
	return [
		...(config?.toolContributions ?? []).map(({ pluginId, handlerId, activationId }) => ({
			kind: "tool" as const,
			pluginId,
			handlerId,
			activationId,
		})),
		...(config?.continuationContributions ?? []).map(({ pluginId, handlerId, activationId }) => ({
			kind: "continuation" as const,
			pluginId,
			handlerId,
			activationId,
		})),
		...(config?.systemPromptProviderContributions ?? []).map(({ pluginId, handlerId, activationId }) => ({
			kind: "system-prompt" as const,
			pluginId,
			handlerId,
			activationId,
		})),
	];
}

function handlerKey(kind: DesktopPluginAgentHandlerKind, pluginId: string, handlerId: string): string {
	return `${kind}\u0000${pluginId}\u0000${handlerId}`;
}
