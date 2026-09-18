/**
 * 画布 Tab 仍懒加载。打开活动面板时若整页 fallback={null}，面板会空一截，
 * 直到 CanvasTab chunk 求值完。壳只占满面板，标题已经在 Tab 标签上。
 */
export function CanvasTabShell() {
	return <div className="relative h-full w-full bg-background" aria-busy="true" />;
}
