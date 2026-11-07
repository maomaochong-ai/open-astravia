// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { Provider } from "jotai";
import { createStore } from "jotai/vanilla";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFileTree } from "./useFileTree";

/**
 * 主进程广播的是 `path.resolve` 之后的路径，渲染层的根目录是项目里存的原始写法。
 * 两边字符串直接比会让 `dir-changed` 全部落空 —— 用户看到的就是
 * 「工作区明明打开了，别人改的文件在目录树里一直不出现」。
 */
interface FsStub {
	readDir: ReturnType<typeof vi.fn>;
	watchDir: ReturnType<typeof vi.fn>;
	unwatchDir: ReturnType<typeof vi.fn>;
	emitDirChanged: (dirPath: string) => void;
}

function installFsStub(): FsStub {
	const handlers = new Set<(dirPath: string) => void>();
	const readDir = vi.fn(async (dirPath: string) => [
		{ name: "src", path: `${dirPath}/src`, isDirectory: true, size: 0, modifiedAt: 0 },
	]);
	const watchDir = vi.fn(async () => {});
	const unwatchDir = vi.fn(async () => {});
	Object.defineProperty(window, "astravia", {
		configurable: true,
		value: {
			fs: {
				readDir,
				watchDir,
				unwatchDir,
				onDirChanged: (handler: (dirPath: string) => void) => {
					handlers.add(handler);
					return () => {
						handlers.delete(handler);
					};
				},
			},
		},
	});
	return {
		readDir,
		watchDir,
		unwatchDir,
		emitDirChanged: (dirPath) => {
			for (const handler of handlers) handler(dirPath);
		},
	};
}

function mountTree(cwd: string): {
	store: ReturnType<typeof createStore>;
	rerenderWith: (next: string) => void;
	unmount: () => void;
} {
	const store = createStore();
	function Harness({ path }: { path: string }): ReactNode {
		useFileTree(path);
		return null;
	}
	const view = render(
		<Provider store={store}>
			<Harness path={cwd} />
		</Provider>,
	);
	return {
		store,
		unmount: () => {
			view.unmount();
		},
		rerenderWith: (next: string) => {
			view.rerender(
				<Provider store={store}>
					<Harness path={next} />
				</Provider>,
			);
		},
	};
}

let fs: FsStub;

beforeEach(() => {
	vi.useFakeTimers();
	fs = installFsStub();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("useFileTree 目录监听", () => {
	it("分隔符与大小写不同的变更事件仍然刷新对应目录", async () => {
		// 项目路径用正斜杠、盘符大写；主进程 resolve 之后回来的是反斜杠、小写盘符。
		mountTree("C:/Work/App");
		await act(async () => {
			await Promise.resolve();
		});
		expect(fs.readDir).toHaveBeenCalledWith("C:/Work/App");

		await act(async () => {
			fs.emitDirChanged("c:\\work\\app");
			vi.advanceTimersByTime(200);
			await Promise.resolve();
		});

		// 重新读的必须是渲染层自己那份路径，否则缓存里会留下一份只在写法上不同的键。
		expect(fs.readDir).toHaveBeenCalledTimes(2);
		expect(fs.readDir).toHaveBeenLastCalledWith("C:/Work/App");
	});

	it("切换工作区只放掉旧目录的监听，不重建当前目录的 watcher", async () => {
		const { rerenderWith } = mountTree("/repo/one");
		await act(async () => {
			await Promise.resolve();
		});
		expect(fs.watchDir).toHaveBeenCalledTimes(1);

		await act(async () => {
			rerenderWith("/repo/two");
			await Promise.resolve();
		});

		expect(fs.unwatchDir).toHaveBeenCalledWith("/repo/one");
		expect(fs.unwatchDir).not.toHaveBeenCalledWith("/repo/two");
		expect(fs.watchDir).toHaveBeenLastCalledWith("/repo/two");
	});

	it("卸载时放掉的是当前目录的监听，而不是挂载那一刻的列表", async () => {
		const { rerenderWith, unmount } = mountTree("/repo/one");
		await act(async () => {
			await Promise.resolve();
		});
		await act(async () => {
			rerenderWith("/repo/two");
			await Promise.resolve();
		});

		act(() => {
			unmount();
		});

		// 登记者是个 Map 且每次换目录都会整体替换：清理时若用挂载那一刻的快照，
		// 这里一次 unwatch 都不会发，主进程那边就留着永远不再有人关的 watcher。
		expect(fs.unwatchDir).toHaveBeenCalledWith("/repo/two");
	});
});
