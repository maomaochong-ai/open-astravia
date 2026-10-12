// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelTransportSettingsSection } from "./ModelTransportSettingsSection";
import { useModelTransportSettingsModel } from "./useModelTransportSettingsModel";

vi.mock("react-i18next", () => {
	const t = (key: string) => key;
	return { useTranslation: () => ({ t }) };
});
vi.mock("./recordSettingsUsage", () => ({ recordSettingsUsage: vi.fn() }));
vi.mock("@shared/store/atoms", () => ({ showToast: vi.fn() }));
vi.mock("../registry", () => ({ SETTINGS_SECTION: { "models-transport": { id: "models-transport" } } }));
vi.mock("@vetta-org/theme-ui/settings", () => ({
	SettingSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
	SettingRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	MotionSelect: ({
		value,
		onValueChange,
		options,
		disabled,
		...props
	}: {
		value: string;
		onValueChange: (value: string) => void;
		options: readonly { value: string; label: string }[];
		disabled?: boolean;
		"aria-label"?: string;
	}) => (
		<select
			value={value}
			disabled={disabled}
			aria-label={props["aria-label"]}
			onChange={(event) => onValueChange(event.currentTarget.value)}
		>
			{options.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	),
}));

function Subject(): JSX.Element {
	return <ModelTransportSettingsSection model={useModelTransportSettingsModel()} />;
}

describe("model transport settings", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("loads the persisted transport and saves a user selection", async () => {
		const setModelTransport = vi.fn(async () => "websocket" as const);
		(window as unknown as { vetta: unknown }).vetta = {
			settings: {
				getModelTransport: vi.fn(async () => "auto" as const),
				setModelTransport,
			},
		};
		render(<Subject />);
		const select = await screen.findByRole("combobox", { name: "modelSettings.transportLabel" });
		await waitFor(() => expect((select as HTMLSelectElement).value).toBe("auto"));

		await userEvent.selectOptions(select, "websocket");

		await waitFor(() => expect(setModelTransport).toHaveBeenCalledWith("websocket"));
		expect((select as HTMLSelectElement).value).toBe("websocket");
	});
});
