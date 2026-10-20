// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { usePageHeaderUtilitySlot } from "./usePageHeaderUtilitySlot";
import { pageHeaderUtilitySlotAtom } from "@shared/store/ui-atoms";

interface Owners {
	conversation: ReactNode | null;
	fileExplorer: ReactNode | null;
}

/** 两个固定 owner，模拟对话页与活动面板文件标签同时存在。 */
function SlotProbe({ owners }: { owners: Owners }) {
	usePageHeaderUtilitySlot("conversation", 0, owners.conversation);
	usePageHeaderUtilitySlot("file-explorer", 10, owners.fileExplorer);
	return null;
}

const stores: Array<ReturnType<typeof createStore>> = [];

afterEach(() => {
	stores.length = 0;
});

function mount(owners: Owners) {
	const store = createStore();
	stores.push(store);
	const view = render(
		<Provider store={store}>
			<SlotProbe owners={owners} />
		</Provider>,
	);
	return {
		read: () => store.get(pageHeaderUtilitySlotAtom),
		update: (next: Owners) =>
			view.rerender(
				<Provider store={store}>
					<SlotProbe owners={next} />
				</Provider>,
			),
		unmount: view.unmount,
	};
}

describe("page header utility slot", () => {
	it("shows the highest-priority owner", async () => {
		const view = mount({ conversation: "chat-button", fileExplorer: "tree-button" });
		await waitFor(() => expect(view.read()).toBe("chat-button"));
	});

	it("keeps the fallback button when the winner unmounts", async () => {
		const view = mount({ conversation: "chat-button", fileExplorer: "tree-button" });
		await waitFor(() => expect(view.read()).toBe("chat-button"));

		// 对话页切走只回收自己那份，文件面板的按钮不能被一起清空。
		act(() => view.update({ conversation: null, fileExplorer: "tree-button" }));
		expect(view.read()).toBe("tree-button");
	});

	it("restores the winner when it comes back", async () => {
		const view = mount({ conversation: null, fileExplorer: "tree-button" });
		await waitFor(() => expect(view.read()).toBe("tree-button"));

		act(() => view.update({ conversation: "chat-button", fileExplorer: "tree-button" }));
		expect(view.read()).toBe("chat-button");
	});

	it("renders nothing when no owner registers a node", async () => {
		const view = mount({ conversation: null, fileExplorer: null });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(view.read()).toBeNull();
	});
});
