import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, string>) =>
			params ? `${key}:${Object.values(params).join(",")}` : key,
		locale: "zh",
	}),
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CreateDesignDialog } from "../src/gallery/CreateDesignDialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	document.body.innerHTML = "";
});

function input(): HTMLInputElement {
	const element = document.body.querySelector("input");
	if (!element) throw new Error("missing input");
	return element;
}

function submit(): void {
	const form = document.body.querySelector("form");
	if (!form) throw new Error("missing form");
	act(() => {
		form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
	});
}

function type(value: string): void {
	act(() => {
		const field = input();
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
		setter?.call(field, value);
		field.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

describe("CreateDesignDialog", () => {
	it("从风格库进来时标题带上体系名，让用户知道在给什么起名", () => {
		act(() => {
			root.render(
				<CreateDesignDialog
					workspacePath="/w"
					busy={false}
					styleName="Linear"
					onCreate={() => {}}
					onClose={() => {}}
				/>,
			);
		});
		expect(document.body.textContent).toContain("gallery.create.withStyle:Linear");
	});

	it("普通新建不显示风格标题", () => {
		act(() => {
			root.render(<CreateDesignDialog workspacePath="/w" busy={false} onCreate={() => {}} onClose={() => {}} />);
		});
		expect(document.body.textContent).toContain("gallery.create.title");
		expect(document.body.textContent).not.toContain("gallery.create.withStyle");
	});

	it("提交把清洗后的项目名交回去", () => {
		const created: string[] = [];
		act(() => {
			root.render(
				<CreateDesignDialog
					workspacePath="/w"
					busy={false}
					styleName="Linear"
					onCreate={(name) => created.push(name)}
					onClose={() => {}}
				/>,
			);
		});
		type("我的 后台 系统");
		submit();
		// 名字会被 toProjectName 清洗成合法目录名（空白 → 连字符）。
		expect(created).toEqual(["我的-后台-系统"]);
	});

	it("名字为空时提交不了，避免落成一个意外项目", () => {
		const created: string[] = [];
		act(() => {
			root.render(
				<CreateDesignDialog
					workspacePath="/w"
					busy={false}
					styleName="Linear"
					onCreate={(name) => created.push(name)}
					onClose={() => {}}
				/>,
			);
		});
		type("   ");
		submit();
		expect(created).toEqual([]);
	});
});
