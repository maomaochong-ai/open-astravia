import { describe, expect, it, vi } from "vitest";
import { HostedRouteService } from "./hosted-route-service.js";

const route = { namespace: "custom-pages", ownerId: "owner", pageId: "main" } as const;

describe("HostedRouteService", () => {
	it("owns namespace registration, path construction, and navigation", async () => {
		const service = new HostedRouteService();
		const open = vi.fn(async () => undefined);
		service.registerNamespace(route.namespace, {
			path: (value) => `/custom/${value.ownerId}/${value.pageId}`,
			open,
		});

		expect(service.path(route)).toBe("/custom/owner/main");
		await service.open(route);
		expect(open).toHaveBeenCalledExactlyOnceWith(route, expect.any(AbortSignal));
	});

	it("rejects duplicate, unknown, invalid, and aborted routes", async () => {
		const service = new HostedRouteService();
		const registration = service.registerNamespace(route.namespace, {
			path: () => "/custom",
			open: async () => undefined,
		});

		expect(() =>
			service.registerNamespace(route.namespace, { path: () => "/duplicate", open: async () => undefined }),
		).toThrow("Hosted route namespace already registered");
		expect(() => service.path({ ...route, pageId: "nested/page" })).toThrow("Invalid hosted route pageId");
		await expect(service.open({ ...route, namespace: "missing" })).rejects.toThrow(
			"Hosted route namespace is not registered",
		);

		const controller = new AbortController();
		controller.abort();
		await expect(service.open(route, controller.signal)).rejects.toMatchObject({ name: "AbortError" });

		registration.dispose();
		expect(() => service.path(route)).toThrow("Hosted route namespace is not registered");
	});
});
