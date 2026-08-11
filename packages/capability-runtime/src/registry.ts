import {
	CAPABILITY_ERROR_CODES,
	CAPABILITY_PUBLISHERS,
	CapabilityError,
	type CapabilityExecutionContext,
	type CapabilityId,
	type CapabilityLayer,
	type CapabilityModule,
	type CapabilityToken,
	capabilityPublisherFromId,
	type Disposable,
} from "@vetta/capability-sdk";
import type { CapabilityProviderBinding } from "./provider.js";

interface ProviderEntry {
	readonly binding: CapabilityProviderBinding;
	readonly controller: AbortController;
	readonly generation: symbol;
	readonly ownerId: string;
}

export const CAPABILITY_MODULE_TRUST_LEVELS = {
	BUILT_IN: "built-in",
	EXTERNAL: "external",
} as const;

export type CapabilityModuleTrustLevel =
	(typeof CAPABILITY_MODULE_TRUST_LEVELS)[keyof typeof CAPABILITY_MODULE_TRUST_LEVELS];

export interface CapabilityModuleRegistrationOptions {
	readonly trust?: CapabilityModuleTrustLevel;
}

function combineSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
	return AbortSignal.any([first, second]);
}

export class CapabilityRegistry {
	private readonly providers = new Map<CapabilityId, ProviderEntry>();

	constructor(readonly layer: CapabilityLayer) {}

	has(capabilityId: CapabilityId): boolean {
		return this.providers.has(capabilityId);
	}

	list(prefix?: string): readonly CapabilityId[] {
		return [...this.providers.keys()]
			.filter((capabilityId) => prefix === undefined || capabilityId.startsWith(prefix))
			.sort();
	}

	registerModule(
		module: CapabilityModule,
		bindings: readonly CapabilityProviderBinding[],
		options: CapabilityModuleRegistrationOptions = {},
	): Disposable {
		const trust = options.trust ?? CAPABILITY_MODULE_TRUST_LEVELS.EXTERNAL;
		if (module.publisher === CAPABILITY_PUBLISHERS.VETTA && trust !== CAPABILITY_MODULE_TRUST_LEVELS.BUILT_IN) {
			throw new CapabilityError(
				CAPABILITY_ERROR_CODES.RESERVED_PUBLISHER,
				`Capability publisher ${CAPABILITY_PUBLISHERS.VETTA} is reserved for built-in modules`,
			);
		}

		const declaredCapabilities = new Map(module.capabilities.map((capability) => [capability.id, capability]));
		if (bindings.length !== declaredCapabilities.size) {
			throw new CapabilityError(
				CAPABILITY_ERROR_CODES.INVALID_MODULE,
				`Capability module ${module.id} must bind every declared capability exactly once`,
			);
		}
		for (const capability of module.capabilities) {
			if (capability.layer !== this.layer) {
				throw new CapabilityError(
					CAPABILITY_ERROR_CODES.LAYER_MISMATCH,
					`Capability ${capability.id} cannot register in the ${this.layer} registry`,
				);
			}
			if (capabilityPublisherFromId(capability.id) !== module.publisher) {
				throw new CapabilityError(
					CAPABILITY_ERROR_CODES.PUBLISHER_MISMATCH,
					`Capability ${capability.id} does not belong to publisher ${module.publisher}`,
				);
			}
		}
		const boundIds = new Set<CapabilityId>();
		for (const binding of bindings) {
			const declared = declaredCapabilities.get(binding.token.id);
			if (
				declared === undefined ||
				declared.layer !== binding.token.layer ||
				declared.version !== binding.token.version ||
				boundIds.has(binding.token.id)
			) {
				throw new CapabilityError(
					CAPABILITY_ERROR_CODES.INVALID_MODULE,
					`Capability module ${module.id} contains an undeclared, incompatible, or duplicate binding`,
				);
			}
			boundIds.add(binding.token.id);
		}

		return this.registerOwner(`module:${module.publisher}:${module.id}`, bindings);
	}

	/** Low-level registration for host-owned provider groups. External modules must use registerModule. */
	registerOwner(ownerId: string, bindings: readonly CapabilityProviderBinding[]): Disposable {
		if (ownerId.trim().length === 0) throw new Error("Capability provider owner id is required");
		const nextIds = new Set<CapabilityId>();
		for (const binding of bindings) {
			if (binding.token.layer !== this.layer) {
				throw new CapabilityError(
					CAPABILITY_ERROR_CODES.LAYER_MISMATCH,
					`Capability ${binding.token.id} cannot register in the ${this.layer} registry`,
				);
			}
			if (nextIds.has(binding.token.id)) {
				throw new CapabilityError(
					CAPABILITY_ERROR_CODES.DUPLICATE_PROVIDER,
					`Capability module ${ownerId} registers ${binding.token.id} more than once`,
				);
			}
			nextIds.add(binding.token.id);
			const current = this.providers.get(binding.token.id);
			if (current && current.ownerId !== ownerId) {
				throw new CapabilityError(
					CAPABILITY_ERROR_CODES.DUPLICATE_PROVIDER,
					`Capability ${binding.token.id} is already provided by ${current.ownerId}`,
				);
			}
		}

		const previousControllers = new Set<AbortController>();
		for (const entry of this.providers.values()) {
			if (entry.ownerId === ownerId) previousControllers.add(entry.controller);
		}

		const controller = new AbortController();
		const generation = Symbol(ownerId);
		for (const [capabilityId, entry] of this.providers) {
			if (entry.ownerId === ownerId && !nextIds.has(capabilityId)) this.providers.delete(capabilityId);
		}
		for (const binding of bindings) {
			this.providers.set(binding.token.id, { binding, controller, generation, ownerId });
		}
		for (const previousController of previousControllers) previousController.abort();

		return {
			dispose: () => {
				for (const [capabilityId, entry] of this.providers) {
					if (entry.ownerId === ownerId && entry.generation === generation) this.providers.delete(capabilityId);
				}
				controller.abort();
			},
		};
	}

	async invoke<Input, Output>(
		capability: CapabilityToken<Input, Output>,
		input: Input,
		context: CapabilityExecutionContext,
	): Promise<Output> {
		const entry = this.providers.get(capability.id);
		if (!entry) {
			throw new CapabilityError(CAPABILITY_ERROR_CODES.NOT_FOUND, `Capability provider not found: ${capability.id}`);
		}
		if (entry.binding.token.version !== capability.version) {
			throw new CapabilityError(
				CAPABILITY_ERROR_CODES.VERSION_MISMATCH,
				`Capability ${capability.id} requires version ${capability.version}, provider exposes ${entry.binding.token.version}`,
			);
		}
		const signal = combineSignals(context.signal, entry.controller.signal);
		try {
			if (signal.aborted) {
				throw new CapabilityError(
					CAPABILITY_ERROR_CODES.ABORTED,
					`Capability invocation aborted: ${capability.id}`,
				);
			}
			const output = await entry.binding.execute(input, { ...context, signal });
			if (signal.aborted) {
				throw new CapabilityError(
					CAPABILITY_ERROR_CODES.ABORTED,
					`Capability invocation aborted: ${capability.id}`,
				);
			}
			return capability.parseOutput(output);
		} catch (error) {
			if (error instanceof CapabilityError) throw error;
			if (signal.aborted) {
				throw new CapabilityError(
					CAPABILITY_ERROR_CODES.ABORTED,
					`Capability invocation aborted: ${capability.id}`,
					{
						cause: error,
					},
				);
			}
			throw new CapabilityError(
				CAPABILITY_ERROR_CODES.PROVIDER_FAILED,
				`Capability provider failed: ${capability.id}`,
				{ cause: error },
			);
		}
	}
}
