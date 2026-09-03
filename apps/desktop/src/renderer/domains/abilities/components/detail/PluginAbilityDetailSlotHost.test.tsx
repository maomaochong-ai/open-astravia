// @vitest-environment jsdom

import { pluginAbilityDetailSlotsAtom } from "../../../../shared/store/atoms";
import { createStore, Provider } from "jotai";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbilityItem, PluginAbility } from "../../types";
import { PluginAbilityDetailSlotHost } from "./PluginAbilityDetailSlotHost";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(cleanup);

function pluginAbility(overrides: Partial<PluginAbility> = {}): PluginAbility {
	return {
		type: "plugin",
		id: "plugin:demo",
		slug: "demo",
		catalogSource: { kind: "local", id: "local" },
		title: "Demo",
		description: "",
		category: "",
		tags: [],
		author: "",
		license: "MIT",
		version: "1.0.0",
		installed: true,
		enabled: true,
		readonly: false,
		needsUpdate: false,
		setupRequired: false,
		busy: false,
		downloadCount: 0,
		isCustom: true,
		isBuiltin: false,
		fromMarket: false,
		searchTerms: [],
		plugin: null,
		permissions: ["ui.slot.ability-detail", "network.fetch"],
		grantedPermissions: [],
		commands: [],
		grantedCommands: [],
		...overrides,
	};
}

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
				<PluginAbilityDetailSlotHost item={item} onOpenPermissions={vi.fn()} />
			</Provider>,
		);

		expect(screen.getByText("feishu:true:true")).toBeTruthy();
		expect(screen.queryByText("other")).toBeNull();
		expect(Matching).toHaveBeenCalled();
	});

	it("explains the missing panel permission and opens review without granting permissions", async () => {
		const item = pluginAbility();
		const onOpenPermissions = vi.fn();
		render(
			<Provider store={createStore()}>
				<PluginAbilityDetailSlotHost item={item} onOpenPermissions={onOpenPermissions} />
			</Provider>,
		);

		expect(screen.getByRole("status").textContent).toContain("permission.detailUnavailable.title");
		expect(screen.getByRole("status").textContent).toContain("permission.detailUnavailable.description");
		await userEvent.click(screen.getByRole("button", { name: "permission.detailUnavailable.review" }));
		expect(onOpenPermissions).toHaveBeenCalledOnce();
		expect(item.grantedPermissions).toEqual([]);
	});

	it("removes the notice and shows the configuration when the refreshed plugin has permission", () => {
		const store = createStore();
		const view = (item: PluginAbility) => (
			<Provider store={store}>
				<PluginAbilityDetailSlotHost item={item} onOpenPermissions={vi.fn()} />
			</Provider>
		);
		const { rerender } = render(view(pluginAbility()));
		expect(screen.getByRole("status")).toBeTruthy();

		store.set(pluginAbilityDetailSlotsAtom, [
			{ pluginId: "demo", id: "demo:setup", abilityId: "demo", component: () => <div>Plugin configuration</div> },
		]);
		rerender(view(pluginAbility({ grantedPermissions: ["ui.slot.ability-detail"] })));

		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.getByText("Plugin configuration")).toBeTruthy();
	});

	it.each([
		{ installed: false },
		{ enabled: false },
		{ permissions: [] },
		{ grantedPermissions: ["ui.slot.ability-detail"] },
	] satisfies Partial<PluginAbility>[])("does not ask for unrelated authorization: %j", (overrides) => {
		render(
			<Provider store={createStore()}>
				<PluginAbilityDetailSlotHost item={pluginAbility(overrides)} onOpenPermissions={vi.fn()} />
			</Provider>,
		);
		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.queryByRole("button")).toBeNull();
	});
});
