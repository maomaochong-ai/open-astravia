import type { RouteErrorPageViewProps } from "@astravia-org/theme-ui/overlays";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

/**
 * TanStack 的 CatchBoundary 会把 React error boundary 的 `info` 一起传下来，
 * 但 `ErrorComponentProps` 的公开类型里没有这个字段，所以这里自己补一个可选形状。
 */
type ErrorComponentInfo = { componentStack?: string };

export function useRouteErrorPageModel(props: ErrorComponentProps): Omit<RouteErrorPageViewProps, "homeAction"> {
	const { error, reset } = props;
	const message = error instanceof Error ? error.message : String(error);
	const componentStack = (props as ErrorComponentProps & { info?: ErrorComponentInfo }).info?.componentStack;

	useEffect(() => {
		// 只记 message 不够定位：React #185（Maximum update depth exceeded）只说明有
		// setState 死循环，真正有用的是发起更新的组件栈。componentStack 由 error
		// boundary 提供，`error.stack` 则是抛出点。
		console.error("[router error]", error);
		if (componentStack) {
			console.error("[router error] component stack", componentStack);
		}
		if (error instanceof Error && error.stack) {
			console.error("[router error] stack", error.stack);
		}
	}, [error, componentStack]);

	return useMemo(
		() => ({
			labels: {
				bannerTitle: "当前页面遇到问题",
				home: "返回首页",
				pageTitle: "页面内容没有正常加载",
				retry: "重试",
				retryPage: "重试当前页面",
				suggestion: "这通常是临时状态。你可以重试当前页面，或先回到首页继续其他操作。",
			},
			message,
			onRetry: reset,
		}),
		[message, reset],
	);
}
