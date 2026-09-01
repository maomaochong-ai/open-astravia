// @vitest-environment jsdom

import { pluginAbilityDetailSlotsAtom } from "../../../../shared/store/atoms";
import { createStore, Provider } from "jotai";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AbilityItem } from "../../types";
import { PluginAbilityDetailSlotHost } from "./PluginAbilityDetailSlotHost";

describe("PluginAbilityDetailSlotHost", () => {
	it("renders only contributions matching the ability slug and passes observable state", () => {
		const Matching = vi.fn(({ abilityId, installed, enabled }) => (
			<div>{`${abilityId}:${installed}:${enabled}`}</div>
		));
		const Other = vi.fn(() => <div>other</div>);
		const store = createStore();
		store.set(pluginAbilityDetailSlotsAtom, [
			{ pluginId: "feishu", id: "feishu:setup", abilityId: "feishu", component: Matching },
			{ pluginId: "other", id: "other:setup", abilityId: "other", component: Other },
		]);
		const item = { slug: "feishu", installed: true, enabled: true } as AbilityItem;

		render(
			<Provider store={store}>
				<PluginAbilityDetailSlotHost item={item} />
			</Provider>,
		);

		expect(screen.getByText("feishu:true:true")).toBeTruthy();
		expect(screen.queryByText("other")).toBeNull();
		expect(Matching).toHaveBeenCalled();
	});
});
