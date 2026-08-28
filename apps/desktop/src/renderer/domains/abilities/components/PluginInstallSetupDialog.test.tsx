// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AbilitiesModel, PluginAbility } from "../types";

vi.mock("@shared/store/atoms", () => ({ confirmDialogAtom: {} }));
vi.mock("jotai", () => ({ useSetAtom: () => vi.fn() }));
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@vetta/ui", () => ({
	Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
		<button type="button" onClick={onClick}>
			{children}
		</button>
	),
	Dialog: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
	DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
	DialogTitle: ({ children }: { children?: ReactNode }) => <h1>{children}</h1>,
	Switch: () => <input type="checkbox" />,
}));

import { PluginInstallSetupDialog } from "./PluginInstallSetupDialog";

describe("PluginInstallSetupDialog", () => {
	it("shows that plugin permissions are not a security sandbox", () => {
		const applyPluginSetup = vi.fn();
		const item = {
			type: "plugin",
			enabled: false,
			busy: false,
			permissions: [],
			grantedPermissions: [],
			commands: ["node"],
			grantedCommands: [],
		} as unknown as PluginAbility;

		render(
			<PluginInstallSetupDialog
				item={item}
				model={{ applyPluginSetup } as unknown as AbilitiesModel}
				onClose={vi.fn()}
			/>,
		);

		expect(screen.getByText("plugin.trustNotice")).toBeTruthy();
		expect(screen.getByText("node")).toBeTruthy();
		fireEvent.click(screen.getByText("actions.confirm"));
		expect(applyPluginSetup).toHaveBeenCalledWith(item, {
			enabled: true,
			grantedPermissions: [],
			grantedCommands: ["node"],
		});
	});
});
