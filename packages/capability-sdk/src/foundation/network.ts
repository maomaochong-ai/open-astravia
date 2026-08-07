import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityOutputSchema } from "../schema.js";
import { CAPABILITY_JSON_VALUE_TYPE, type CapabilityJsonValue } from "./json.js";

const networkRequestInputType = Type.Object({
	pluginId: Type.String({ minLength: 1 }),
	request: CAPABILITY_JSON_VALUE_TYPE,
});

export type NetworkRequestInput = Readonly<Static<typeof networkRequestInputType>>;

const networkRequestInputSchema = defineCapabilityInputSchema(networkRequestInputType, { clean: true });
const networkRequestOutputSchema = defineCapabilityOutputSchema(CAPABILITY_JSON_VALUE_TYPE);

export const FOUNDATION_NETWORK_CAPABILITIES = {
	REQUEST: defineCapability<NetworkRequestInput, CapabilityJsonValue>({
		id: "cap.foundation.vetta.network.request",
		kind: "command",
		layer: CAPABILITY_LAYERS.FOUNDATION,
		version: 1,
		input: networkRequestInputSchema,
		output: networkRequestOutputSchema,
	}),
} as const;

export const FOUNDATION_NETWORK_CAPABILITY_CATALOG = createCapabilityCatalog(
	Object.values(FOUNDATION_NETWORK_CAPABILITIES),
);
