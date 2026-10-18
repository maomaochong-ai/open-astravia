import type { RouteErrorPageViewProps } from "@astravia-org/theme-ui/overlays";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { reactComponentStack } from "../lib/react-error-details";
import { describeRouteError, type RouteErrorKind } from "../lib/route-error-description";

/**
 * TanStack 的 `CatchBoundary` 在渲染 `errorComponent` 时只传 `{ error, reset }`，
 * `componentDidCatch` 收到的 `ErrorInfo` 不会进入 props —— 组件栈只能从根节点
 * `createRoot({ onCaughtError })` 那条路拿到，见 `shared/lib/react-error-details`。
 * 这里仍保留对 `info` 的读取，是为了兼容将来把 `errorInfo` 透传下来的 Router 版本。
 */
type ErrorComponentInfo = { componentStack?: string };

/** 组件栈可能很长，错误页只展示开头这段，足够指认循环所在的组件链。 */
const DETAILS_STACK_LIMIT = 4000;

interface RouteErrorCopy {
	readonly bannerTitle: string;
	/** 横幅下的一句话：已知错误给归类解释，未知错误给原始 message。 */
	readonly message: string;
	readonly pageTitle: string;
	readonly suggestion: string;
}

type Translate = (key: string) => string;

function copyFor(kind: RouteErrorKind, rawMessage: string, t: Translate): RouteErrorCopy {
	if (kind === "updateDepth") {
		return {
			bannerTitle: t("routeError.updateDepth.bannerTitle"),
			message: t("routeError.updateDepth.bannerMessage"),
			pageTitle: t("routeError.updateDepth.pageTitle"),
			suggestion: t("routeError.updateDepth.suggestion"),
		};
	}
	if (kind === "hooksOrder") {
		return {
			bannerTitle: t("routeError.hooksOrder.bannerTitle"),
			message: t("routeError.hooksOrder.bannerMessage"),
			pageTitle: t("routeError.hooksOrder.pageTitle"),
			suggestion: t("routeError.hooksOrder.suggestion"),
		};
	}
	return {
		bannerTitle: t("routeError.bannerTitle"),
		message: rawMessage,
		pageTitle: t("routeError.pageTitle"),
		suggestion: t("routeError.suggestion"),
	};
}

export function useRouteErrorPageModel(props: ErrorComponentProps): Omit<RouteErrorPageViewProps, "homeAction"> {
	const { error, reset } = props;
	const { t } = useTranslation("common");
	const translate = useCallback<Translate>((key) => String((t as unknown as (key: string) => unknown)(key)), [t]);
	const message = error instanceof Error ? error.message : String(error);
	const description = useMemo(() => describeRouteError(message), [message]);
	const forwardedStack = (props as ErrorComponentProps & { info?: ErrorComponentInfo }).info?.componentStack;
	const componentStack = useMemo(() => {
		const captured = reactComponentStack(error);
		return captured ?? forwardedStack ?? null;
	}, [error, forwardedStack]);

	useEffect(() => {
		// 生产构建里 React 只留编号，真正有用的是发起更新的组件栈；它由根节点的
		// onCaughtError 记下并写进 [react error] 日志，这里单独标出「整页失败」这件事，
		// 方便在日志里和组件级错误区分。
		console.error("[router error]", error);
		if (componentStack) {
			console.error("[router error] component stack", componentStack);
		}
	}, [error, componentStack]);

	const copy = useMemo(() => copyFor(description.kind, message, translate), [description.kind, message, translate]);

	const details = useMemo(() => {
		const stack = componentStack?.trim();
		if (!stack) return description.kind === "unknown" ? null : message;
		const clipped = stack.length > DETAILS_STACK_LIMIT ? `${stack.slice(0, DETAILS_STACK_LIMIT)}…` : stack;
		return `${message}\n\n${translate("routeError.detailsComponentStack")}\n${clipped}`;
	}, [componentStack, description.kind, message, translate]);

	const onReloadWindow = useCallback(() => {
		window.location.reload();
	}, []);

	return useMemo(
		() => ({
			labels: {
				bannerTitle: copy.bannerTitle,
				detailsToggle: translate("routeError.detailsToggle"),
				home: translate("routeError.home"),
				pageTitle: copy.pageTitle,
				reloadWindow: translate("routeError.reloadWindow"),
				retry: translate("routeError.retry"),
				retryPage: translate("routeError.retryPage"),
				suggestion: copy.suggestion,
			},
			details,
			// 更新死循环下重试只会再撞一次同样的循环，主按钮应该是重载。
			preferredAction: description.kind === "updateDepth" ? "reload" : "retry",
			message: copy.message,
			onReloadWindow,
			onRetry: reset,
		}),
		[copy, description.kind, details, onReloadWindow, reset, translate],
	);
}
