/**
 * 组件栈的旁路缓存。
 *
 * TanStack 的 `CatchBoundary` 在渲染 `errorComponent` 时只传 `error` 与 `reset`，React 交给
 * `componentDidCatch` 的 `info.componentStack` 被它丢掉了 —— 路由错误组件永远拿不到栈。
 * 而根节点 `createRoot({ onCaughtError })` 对同一个错误仍会拿到完整 `ErrorInfo`，所以在那里
 * 先把栈按 error 对象记下来，错误页再取回来展示与落日志。
 *
 * React 只会对同一个错误实例回调一次，用 `WeakMap` 跟随 error 生命周期，不需要清理。
 */
const componentStacks = new WeakMap<object, string>();

export function rememberReactComponentStack(error: unknown, componentStack: string | undefined | null): void {
	if (!componentStack) return;
	if (typeof error !== "object" || error === null) return;
	if (componentStacks.has(error)) return;
	componentStacks.set(error, componentStack);
}

export function reactComponentStack(error: unknown): string | null {
	if (typeof error !== "object" || error === null) return null;
	return componentStacks.get(error) ?? null;
}
