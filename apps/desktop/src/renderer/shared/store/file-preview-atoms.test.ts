// @vitest-environment jsdom
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import { activityPanelOpenAtom, activityPanelTabByProjectAtom } from "./activity-atoms";
import { clearFileExplorerRevealRequestAtom, fileExplorerRevealRequestAtom } from "./file-atoms";
import { inlineFilePreviewAtom, openFileInActivityWorkspaceAtom } from "./file-preview-atoms";

const store = getDefaultStore();

describe("openFileInActivityWorkspaceAtom", () => {
	beforeEach(() => {
		store.set(activityPanelOpenAtom, false);
		store.set(activityPanelTabByProjectAtom, new Map());
		store.set(inlineFilePreviewAtom, null);
		const pending = store.get(fileExplorerRevealRequestAtom);
		if (pending) store.set(clearFileExplorerRevealRequestAtom, pending.id);
	});

	it("展开文件 tab、载入预览，并把定位请求交给文件树", () => {
		store.set(openFileInActivityWorkspaceAtom, { workspaceId: "/ws", path: "/ws/src/main.ts" });

		expect(store.get(activityPanelOpenAtom)).toBe(true);
		expect(store.get(activityPanelTabByProjectAtom).get("/ws")).toBe("file");
		expect(store.get(inlineFilePreviewAtom)).toMatchObject({ name: "main.ts", path: "/ws/src/main.ts" });
		expect(store.get(fileExplorerRevealRequestAtom)?.path).toBe("/ws/src/main.ts");
	});

	it("同一路径再点一次会拿到新的请求 id", () => {
		store.set(openFileInActivityWorkspaceAtom, { workspaceId: "/ws", path: "/ws/src/main.ts" });
		const first = store.get(fileExplorerRevealRequestAtom);

		store.set(openFileInActivityWorkspaceAtom, { workspaceId: "/ws", path: "/ws/src/main.ts" });
		const second = store.get(fileExplorerRevealRequestAtom);

		expect(first?.path).toBe("/ws/src/main.ts");
		expect(second?.path).toBe("/ws/src/main.ts");
		expect(second?.id).not.toBe(first?.id);
	});

	it("只切换目标工作空间的 tab，不影响其他项目当前的 tab", () => {
		store.set(activityPanelTabByProjectAtom, new Map([["/other", "browser"]]));

		store.set(openFileInActivityWorkspaceAtom, { workspaceId: "/ws", path: "/ws/README.md" });

		const tabs = store.get(activityPanelTabByProjectAtom);
		expect(tabs.get("/ws")).toBe("file");
		expect(tabs.get("/other")).toBe("browser");
	});
});
