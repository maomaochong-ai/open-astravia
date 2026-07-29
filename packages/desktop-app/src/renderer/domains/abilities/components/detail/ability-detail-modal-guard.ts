const DIALOG_CONTENT_SELECTOR = '[data-slot="dialog-content"]';

interface DialogLayerQueryRoot {
	querySelector(selector: string): unknown;
}

/**
 * Portal Dialog 在 DOM 中位于 Drawer 外部。Dialog 关闭交互会被 Drawer 当成外部点击，
 * 因此在 Dialog（含退出动画）仍挂载时忽略同一次 Drawer 关闭请求。
 */
export function shouldCloseAbilityDetailDrawer(nextOpen: boolean, root: DialogLayerQueryRoot): boolean {
	return !nextOpen && root.querySelector(DIALOG_CONTENT_SELECTOR) === null;
}
