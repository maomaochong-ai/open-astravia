import { CapabilityAccessController, CapabilityHub, type CapabilityProviderBinding } from "@vetta/capability-runtime";
import type {
	CapabilityAccessHandle,
	CapabilityAccessSessionFactory,
	CapabilityAccessSessionOptions,
	Disposable,
} from "@vetta/capability-sdk";

export class RendererCapabilityHost implements CapabilityAccessSessionFactory {
	private readonly hub = new CapabilityHub();
	private readonly access = new CapabilityAccessController(this.hub);

	createSession(options: CapabilityAccessSessionOptions): CapabilityAccessHandle {
		return this.access.createSession(options);
	}

	registerDomainProviders(ownerId: string, bindings: readonly CapabilityProviderBinding[]): Disposable {
		return this.hub.domain.registerOwner(ownerId, bindings);
	}
}

export const rendererCapabilityHost = new RendererCapabilityHost();
