import { describe, expect, it } from "vitest";
import { CAPABILITY_ERROR_CODES, CAPABILITY_PREFIXES } from "../../src/contracts.js";
import {
	DOMAIN_NAVIGATION_CAPABILITIES,
	DOMAIN_NAVIGATION_CAPABILITY_CATALOG,
	isValidHostedRouteSegment,
} from "../../src/domain.js";

describe("navigation domain capabilities", () => {
	it("publishes one stable hosted-route navigation command", () => {
		expect(DOMAIN_NAVIGATION_CAPABILITIES.OPEN_HOSTED_ROUTE.id).toBe(
			`${CAPABILITY_PREFIXES.VETTA_DOMAIN}navigation.open-hosted-route`,
		);
	});

	it("validates serializable system-neutral hosted-route references", () => {
		expect(
			DOMAIN_NAVIGATION_CAPABILITIES.OPEN_HOSTED_ROUTE.parseInput({
				namespace: "custom-pages",
				ownerId: "plugin.example",
				pageId: "main-view",
				ignored: true,
			}),
		).toEqual({ namespace: "custom-pages", ownerId: "plugin.example", pageId: "main-view" });

		for (const route of [
			{ namespace: "../namespace", ownerId: "owner", pageId: "page" },
			{ namespace: "custom", ownerId: "../owner", pageId: "page" },
			{ namespace: "custom", ownerId: "owner", pageId: "nested/page" },
			{ namespace: "custom", ownerId: "owner", pageId: "" },
		]) {
			expect(() => DOMAIN_NAVIGATION_CAPABILITIES.OPEN_HOSTED_ROUTE.parseInput(route)).toThrowError(
				expect.objectContaining({ code: CAPABILITY_ERROR_CODES.INVALID_INPUT }),
			);
		}
		expect(DOMAIN_NAVIGATION_CAPABILITIES.OPEN_HOSTED_ROUTE.parseOutput(undefined)).toBeUndefined();
	});

	it("shares the same conservative segment validator with host adapters", () => {
		expect(isValidHostedRouteSegment("owner.page_1-view")).toBe(true);
		expect(isValidHostedRouteSegment("../owner")).toBe(false);
		expect(isValidHostedRouteSegment("nested/page")).toBe(false);
	});

	it("publishes a serializable catalog entry", () => {
		expect(DOMAIN_NAVIGATION_CAPABILITY_CATALOG).toHaveLength(1);
		expect(DOMAIN_NAVIGATION_CAPABILITY_CATALOG[0]).toMatchObject({
			id: DOMAIN_NAVIGATION_CAPABILITIES.OPEN_HOSTED_ROUTE.id,
			kind: "command",
			layer: "domain",
			outputSchema: false,
		});
		expect(() => JSON.stringify(DOMAIN_NAVIGATION_CAPABILITY_CATALOG)).not.toThrow();
	});
});
