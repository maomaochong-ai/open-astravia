import { type Static, Type } from "@sinclair/typebox";
import { createCapabilityCatalog } from "../catalog.js";
import { CAPABILITY_LAYERS, defineCapability } from "../contracts.js";
import { defineCapabilityInputSchema, defineCapabilityNoOutputSchema } from "../schema.js";

/** Shared route-segment contract. Hosts remain responsible for URL encoding. */
export const HOSTED_ROUTE_SEGMENT_PATTERN = "^[a-zA-Z0-9][a-zA-Z0-9._-]*$";

const hostedRouteSegmentPattern = new RegExp(HOSTED_ROUTE_SEGMENT_PATTERN);

export function isValidHostedRouteSegment(value: string): boolean {
	return hostedRouteSegmentPattern.test(value);
}

const hostedRouteRefType = Type.Object(
	{
		namespace: Type.String({ pattern: HOSTED_ROUTE_SEGMENT_PATTERN }),
		ownerId: Type.String({ pattern: HOSTED_ROUTE_SEGMENT_PATTERN }),
		pageId: Type.String({ pattern: HOSTED_ROUTE_SEGMENT_PATTERN }),
	},
	{ additionalProperties: false },
);

export type HostedRouteRef = Readonly<Static<typeof hostedRouteRefType>>;
export type OpenHostedRouteInput = HostedRouteRef;

const openHostedRouteInputSchema = defineCapabilityInputSchema(hostedRouteRefType, { clean: true });
const noOutputSchema = defineCapabilityNoOutputSchema();

export const DOMAIN_NAVIGATION_CAPABILITIES = {
	OPEN_HOSTED_ROUTE: defineCapability<OpenHostedRouteInput, undefined>({
		id: "cap.domain.vetta.navigation.open-hosted-route",
		kind: "command",
		layer: CAPABILITY_LAYERS.DOMAIN,
		version: 1,
		input: openHostedRouteInputSchema,
		output: noOutputSchema,
	}),
} as const;

export const DOMAIN_NAVIGATION_CAPABILITY_CATALOG = createCapabilityCatalog(
	Object.values(DOMAIN_NAVIGATION_CAPABILITIES),
);
