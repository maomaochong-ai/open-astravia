import { type Disposable, type HostedRouteRef, isValidHostedRouteSegment } from "@vetta/capability-sdk";

export interface HostedRouteNamespaceAdapter {
	path(route: HostedRouteRef): string;
	open(route: HostedRouteRef, signal: AbortSignal): Promise<void>;
}

interface HostedRouteNamespaceEntry {
	readonly adapter: HostedRouteNamespaceAdapter;
	readonly generation: symbol;
}

/** Desktop-owned routing kernel. Capability is one authorized entry point into this service. */
export class HostedRouteService {
	private readonly namespaces = new Map<string, HostedRouteNamespaceEntry>();

	registerNamespace(namespace: string, adapter: HostedRouteNamespaceAdapter): Disposable {
		if (!isValidHostedRouteSegment(namespace)) throw new Error(`Invalid hosted route namespace: ${namespace}`);
		if (this.namespaces.has(namespace)) throw new Error(`Hosted route namespace already registered: ${namespace}`);

		const generation = Symbol(namespace);
		this.namespaces.set(namespace, { adapter, generation });
		return {
			dispose: () => {
				if (this.namespaces.get(namespace)?.generation === generation) this.namespaces.delete(namespace);
			},
		};
	}

	path(route: HostedRouteRef): string {
		return this.adapter(route).path(route);
	}

	async open(route: HostedRouteRef, signal: AbortSignal = new AbortController().signal): Promise<void> {
		const adapter = this.adapter(route);
		if (signal.aborted) throw new DOMException("Hosted route navigation aborted", "AbortError");
		await adapter.open(route, signal);
		if (signal.aborted) throw new DOMException("Hosted route navigation aborted", "AbortError");
	}

	private adapter(route: HostedRouteRef): HostedRouteNamespaceAdapter {
		for (const [name, value] of [
			["namespace", route.namespace],
			["ownerId", route.ownerId],
			["pageId", route.pageId],
		] as const) {
			if (!isValidHostedRouteSegment(value)) throw new Error(`Invalid hosted route ${name}: ${value}`);
		}
		const entry = this.namespaces.get(route.namespace);
		if (!entry) throw new Error(`Hosted route namespace is not registered: ${route.namespace}`);
		return entry.adapter;
	}
}

export const desktopHostedRouteService = new HostedRouteService();
