// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ModelsModelForm } from "./ModelsModelForm";
import { emptyModel, type ModelFormState } from "./useModelsSettingsModel";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function Harness({ initial }: { initial: ModelFormState }): JSX.Element {
	const [form, setForm] = useState(initial);
	return (
		<ModelsModelForm form={form} setForm={setForm} />
	);
}

/** 档位行是表单里最后三组文本输入，按渲染顺序取出来即为用户看到的顺序。 */
function levelInputs(): string[] {
	return screen
		.getAllByRole("textbox")
		.slice(-3)
		.map((input) => (input as HTMLInputElement).value);
}

function dragHandle(index: number): HTMLElement {
	return screen.getAllByTitle("reasoningDrag")[index] as HTMLElement;
}

function rowOf(index: number): HTMLElement {
	return dragHandle(index).parentElement as HTMLElement;
}

/** jsdom 不实现 DataTransfer，React 只透传它，给一个够用的假实现即可。 */
function fakeDataTransfer(): DataTransfer {
	return { effectAllowed: "", dropEffect: "", setData: vi.fn(), getData: () => "" } as unknown as DataTransfer;
}

/** `fireEvent` 的 init 拿不到 clientY（jsdom 没有 DragEvent），显式构造带坐标的事件。 */
function dragEvent(type: string, element: HTMLElement, clientY: number, dataTransfer: DataTransfer): void {
	const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
	Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
	fireEvent(element, event);
}

function drag(from: number, to: number, clientY: number): void {
	const dataTransfer = fakeDataTransfer();
	dragEvent("dragstart", dragHandle(from), 0, dataTransfer);
	dragEvent("dragover", rowOf(to), clientY, dataTransfer);
	dragEvent("drop", rowOf(to), clientY, dataTransfer);
}

const REASONING_FORM: ModelFormState = {
	...emptyModel,
	id: "qwen3",
	reasoning: true,
	reasoningLevels: ["low", "medium", "high"],
	defaultReasoningLevel: "low",
};

describe("ModelsModelForm reasoning level drag", () => {
	it("reorders the added levels when a row is dropped below another one", () => {
		render(<Harness initial={REASONING_FORM} />);
		expect(levelInputs()).toEqual(["low", "medium", "high"]);

		// 落点在下半部 ⇒ 放到该行之后（jsdom 里行高为 0，clientY > 0 即下半部）。
		drag(0, 2, 10);

		expect(levelInputs()).toEqual(["medium", "high", "low"]);
	});

	it("reorders upward when dropped on the upper half", () => {
		render(<Harness initial={REASONING_FORM} />);

		drag(2, 1, 0);

		expect(levelInputs()).toEqual(["low", "high", "medium"]);
	});

	it("keeps the order when a row is dropped on itself", () => {
		render(<Harness initial={REASONING_FORM} />);

		drag(1, 1, 0);

		expect(levelInputs()).toEqual(["low", "medium", "high"]);
	});

	it("keeps editing a level after it has been reordered", () => {
		render(<Harness initial={REASONING_FORM} />);

		drag(0, 2, 10);
		fireEvent.change(screen.getAllByRole("textbox").slice(-1)[0] as HTMLElement, { target: { value: "max" } });

		expect(levelInputs()).toEqual(["medium", "high", "max"]);
	});
});
