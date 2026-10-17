import type { IDisposable } from "@xterm/xterm";

/**
 * 先卸渲染器 addon，再销毁 xterm 实例。
 *
 * xterm 自己销毁时按注册顺序走：核心（连同 linkifier）先释放，addon 后释放。渲染器 addon
 * 在释放时会重建内置 DOM 渲染器做兜底，而 DOM 渲染器构造要用 linkifier——顺序反过来就是
 * 拿已释放的 linkifier 去订阅，抛 `Cannot read properties of undefined (reading
 * 'onShowLinkUnderline')`，整个会话页会被错误边界接管。
 */
export function teardownTerminal(terminal: IDisposable, rendererAddon?: IDisposable | null): void {
	rendererAddon?.dispose();
	terminal.dispose();
}
