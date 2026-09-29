// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ManualMcpDialog } from "./ManualMcpDialog";
import {
	emptyMcpServer,
	type McpEditMode,
	type McpSettingsModel,
	type McpServerFormState,
} from "./useMcpSettingsModel";

Range.prototype.getBoundingClientRect = () => new DOMRect();
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("./McpServerForm", () => ({
	McpServerFields: () => <div>form-fields</div>,
}));

function DialogHarness({
	onJsonAdd,
	initialJsonError = null,
	onJsonErrorClear = () => {},
}: {
	onJsonAdd: (json: string) => void;
	initialJsonError?: string | null;
	onJsonErrorClear?: () => void;
}): JSX.Element {
	const [mode, setMode] = useState<McpEditMode>("visual");
	const [jsonText, setJsonText] = useState("");
	const [jsonError, setJsonError] = useState<string | null>(initialJsonError);
	const [serverForm, setServerForm] = useState<McpServerFormState>({ ...emptyMcpServer });
	const model = {
		addingServer: true,
		mode,
		jsonText,
		jsonError,
		serverForm,
		saving: false,
		setServerForm,
		setJsonText,
		clearJsonError: () => {
			setJsonError(null);
			onJsonErrorClear();
		},
		onModeSwitch: setMode,
		onCancelAddServer: () => {},
		onAddServer: async () => {},
		onAddServersFromJson: async () => {
			onJsonAdd(jsonText);
			return true;
		},
	} as McpSettingsModel;

	return <ManualMcpDialog model={model} />;
}

describe("ManualMcpDialog", () => {
	it("switches from the form to JSON configuration and submits the pasted standard config", async () => {
		const user = userEvent.setup();
		const onJsonAdd = vi.fn();
		render(<DialogHarness onJsonAdd={onJsonAdd} />);

		await user.click(screen.getByRole("button", { name: "mcpStore.useJsonConfig" }));
		const editor = screen.getByRole("textbox", { name: "mcpStore.jsonInputLabel" });
		expect(document.querySelector(".cm-gutters")).toBeNull();
		const json = JSON.stringify({ mcpServers: { playwright: { command: "npx" } } });
		await user.click(editor);
		await user.keyboard("{Control>}f{/Control}");
		expect(document.querySelector(".cm-search")).toBeNull();
		await user.paste(json);
		await user.click(screen.getByRole("button", { name: "addServer" }));

		expect(onJsonAdd).toHaveBeenCalledWith(json);
		expect(screen.getByRole("button", { name: "mcpStore.useFormConfig" })).toBeDefined();
	});

	it("associates a JSON error with the input and clears it when the user edits", async () => {
		const user = userEvent.setup();
		const onJsonErrorClear = vi.fn();
		render(
			<DialogHarness
				onJsonAdd={() => {}}
				initialJsonError="jsonParseError"
				onJsonErrorClear={onJsonErrorClear}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "mcpStore.useJsonConfig" }));
		const editor = screen.getByRole("textbox", { name: "mcpStore.jsonInputLabel" });
		const alert = screen.getByRole("alert");
		expect(editor.getAttribute("aria-invalid")).toBe("true");
		expect(editor.getAttribute("aria-describedby")).toBe(alert.id);

		await user.click(editor);
		await user.paste("{");

		expect(onJsonErrorClear).toHaveBeenCalled();
		expect(screen.queryByRole("alert")).toBeNull();
		expect(editor.getAttribute("aria-invalid")).toBe("false");
	});
});
