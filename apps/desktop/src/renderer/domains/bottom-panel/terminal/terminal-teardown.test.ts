/**
 * @vitest-environment jsdom
 */
import { Terminal } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import { teardownTerminal } from "./terminal-teardown";

/** xterm 的内部字段没有公开类型，这里只取用得到的那一个入口。 */
type TerminalInternals = { _core: { _createRenderer(): unknown } };

/**
 * 复刻 `@xterm/addon-canvas@0.7.0` 的释放逻辑：`toDisposable(() => {
 * setRenderer(this._terminal._core._createRenderer()); ... })`。
 * 它面对的是内置 DOM 渲染器，而 DOM 渲染器构造要读核心里的 linkifier。
 */
class CanvasAddonLike {
	private terminal: Terminal | null = null;

	activate(terminal: Terminal): void {
		this.terminal = terminal;
	}

	dispose(): void {
		(this.terminal as unknown as TerminalInternals | null)?._core._createRenderer();
	}
}

/** jsdom 的 canvas 没有实现；xterm 的 DOM 渲染器只需要拿到 null 就自行降级。 */
function stubCanvas(): void {
	Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => null });
}

/** xterm 打开终端时会读 `window.matchMedia`，jsdom 没有实现。 */
function stubMatchMedia(): void {
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false,
		}),
	});
}

function openTerminalWithCanvasLikeAddon(): { terminal: Terminal; addon: CanvasAddonLike } {
	stubMatchMedia();
	stubCanvas();
	const container = document.createElement("div");
	document.body.appendChild(container);
	const terminal = new Terminal();
	terminal.open(container);
	const addon = new CanvasAddonLike();
	terminal.loadAddon(addon as never);
	return { terminal, addon };
}

describe("teardownTerminal", () => {
	it("先释放渲染器 addon，再销毁终端", () => {
		const order: string[] = [];
		const terminal = { dispose: () => order.push("terminal") };
		const addon = { dispose: () => order.push("addon") };

		teardownTerminal(terminal, addon);

		expect(order).toEqual(["addon", "terminal"]);
	});

	it("没有渲染器 addon 时照样销毁终端", () => {
		const dispose = vi.fn();

		teardownTerminal({ dispose }, null);

		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("反过来的顺序会踩到已释放的 linkifier：先销毁终端再释放 addon 必抛错", () => {
		const { terminal } = openTerminalWithCanvasLikeAddon();

		// 这就是用户侧看到的那次崩溃：终端核心先释放，addon 随后重建 DOM 渲染器时读到
		// undefined 的 linkifier。断言它确实会炸，保证下面的修复不是空转。
		expect(() => terminal.dispose()).toThrowError(/onShowLinkUnderline/);
	});

	it("先释放 addon 再销毁终端不会抛错", () => {
		const { terminal, addon } = openTerminalWithCanvasLikeAddon();
		const dispose = vi.spyOn(addon, "dispose");

		expect(() => teardownTerminal(terminal, addon)).not.toThrowError();
		expect(dispose).toHaveBeenCalledTimes(1);
	});
});
