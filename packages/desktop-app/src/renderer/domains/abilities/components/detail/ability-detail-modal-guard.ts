/**
 * Drawer 关闭守卫（Radix Vaul Drawer + Portal Dialog 共存时的冲突避免）。
 *
 * 原始问题：Portal Dialog 的 backdrop click 会冒泡触发 Drawer 的
 * `onOpenChange(false)`，导致用户只想关 Dialog 却顺带关了 Drawer。
 *
 * 旧实现只看"有没有 Dialog 挂载"——代价是：用户在 Drawer 里弹了 Dialog
 * （如 PluginInstallSetupDialog）后，再想主动关 Drawer 也被阻止，
 * 表现为"点击叉号关不掉"。
 *
 * 新实现额外检查 Radix Dialog 的 `data-state`：
 *   - data-state="open"：Dialog 活跃中，阻止 Drawer 关闭（避免 backdrop 冒泡连关）
 *   - 其他（closing/closed）：Dialog 已在退出动画中，放行 Drawer 关闭
 *
 * nextOpen=true 保持旧行为返回 false——Radix open→open 调用不应该被守卫放行。
 */
const DIALOG_SELECTOR = '[data-slot="dialog-content"]';
const RADIX_STATE_ATTR = "data-state";

interface DialogLayerQueryRoot {
	querySelector(selector: string): Element | null;
}

export function shouldCloseAbilityDetailDrawer(nextOpen: boolean, root: DialogLayerQueryRoot): boolean {
	if (nextOpen) return false; // 保持旧行为：open→open 不触发守卫逻辑
	const dialog = root.querySelector(DIALOG_SELECTOR);
	if (!dialog) return true;
	// Dialog 还在活跃（data-state="open"）——阻止 Drawer 关
	if (dialog.getAttribute(RADIX_STATE_ATTR) === "open") return false;
	// Dialog 已在退出动画中（closing/closed）——放行，让 Drawer 也一起关
	return true;
}
