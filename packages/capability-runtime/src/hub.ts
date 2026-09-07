import {
	CAPABILITY_ERROR_CODES,
	CAPABILITY_LAYERS,
	CapabilityError,
	type CapabilityExecutionContext,
	type CapabilityId,
	type CapabilityToken,
} from "@vetta/capability-sdk";
import { CapabilityRegistry } from "./registry.js";

export class CapabilityHub {
	readonly domain = new CapabilityRegistry(CAPABILITY_LAYERS.DOMAIN);
	readonly foundation = new CapabilityRegistry(CAPABILITY_LAYERS.FOUNDATION);

	has(capabilityId: CapabilityId): boolean {
		return this.foundation.has(capabilityId) || this.domain.has(capabilityId);
	}

	async invoke<Input, Output, Event = never>(
		capability: CapabilityToken<Input, Output, Event>,
		input: Input,
		context: CapabilityExecutionContext<Event>,
	): Promise<Output> {
		switch (capability.layer) {
			case CAPABILITY_LAYERS.FOUNDATION:
				return this.foundation.invoke(capability, input, context);
			case CAPABILITY_LAYERS.DOMAIN:
				return this.domain.invoke(capability, input, context);
			default:
				throw new CapabilityError(
					CAPABILITY_ERROR_CODES.LAYER_MISMATCH,
					`Unsupported capability layer for ${capability.id}`,
				);
		}
	}
}
