// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginAbility } from "../../types";
import { PluginAbilityHeaderActions } from "./PluginAbilityHeaderActions";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { version?: string }) =>
			options?.version ? `${key}:${options.version}` : key,
	}),
}));

function pluginAbility(overrides: Partial<PluginAbility> = {}): PluginAbility {
	return {
		type: "plugin",
		id: "plugin:demo",
		slug: "demo",
		installed: true,
		busy: false,
		permissions: ["workspace.read"],
		...overrides,
	} as unknown as PluginAbility;
}

afterEach(cleanup);

describe("PluginAbilityHeaderActions", () => {
	it("keeps reload first in the detail header and exposes the pending version", async () => {
		const onReload = vi.fn();
		const onOpenPermissions = vi.fn();
		render(
			<PluginAbilityHeaderActions
				item={pluginAbility({ pendingVersion: "2.0.0" })}
				onReload={onReload}
				onOpenPermissions={onOpenPermissions}
			/>,
		);

		const buttons = screen.getAllByRole("button");
		expect(buttons.map((button) => button.textContent)).toEqual([
			"plugin.reloadVersion:2.0.0",
			"permission.page.open",
		]);
		await userEvent.click(buttons[0]!);
		expect(onReload).toHaveBeenCalledOnce();
	});

	it("announces the active reload instead of leaving a disabled button without feedback", () => {
		render(
			<PluginAbilityHeaderActions
				item={pluginAbility({ busy: true, operation: "reloading" })}
				onReload={vi.fn()}
				onOpenPermissions={vi.fn()}
			/>,
		);

		expect(screen.getByRole("status").textContent).toBe("operation.reloading");
		expect((screen.getByRole("button", { name: "operation.reloading" }) as HTMLButtonElement).disabled).toBe(true);
	});
});
