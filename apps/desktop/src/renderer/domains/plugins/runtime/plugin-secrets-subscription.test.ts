import { describe, expect, it, vi } from "vitest";
import { subscribePluginSecretsChanged } from "./plugin-secrets-subscription";

describe("subscribePluginSecretsChanged", () => {
	it("keeps older hosts loadable when notifications are unavailable", () => {
		const listener = vi.fn();
		const unsubscribe = subscribePluginSecretsChanged({}, "plugin-a", listener);

		expect(() => unsubscribe()).not.toThrow();
		expect(listener).not.toHaveBeenCalled();
	});

	it("filters notifications by plugin and forwards keys", () => {
		let emit: ((payload: { pluginId: string; keys: string[] }) => void) | undefined;
		const listener = vi.fn();
		const unsubscribe = subscribePluginSecretsChanged(
			{
				onSecretsChanged: (next) => {
					emit = next;
					return () => undefined;
				},
			},
			"plugin-a",
			listener,
		);

		emit?.({ pluginId: "plugin-b", keys: ["ignored"] });
		emit?.({ pluginId: "plugin-a", keys: ["token"] });
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(["token"]);
		unsubscribe();
	});
});
