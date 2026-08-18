/**
 * Vetta 云服务 UI 挂载点（宿主侧）。
 *
 * 宿主代码一律从这里取云服务组件，不得静态 import `@cloud/**`：
 * 本文件用构建期常量 + 动态 import 隔离 cloud chunk，lite 构建
 * （VETTA_CLOUD_ENABLED=false）下各槽位恒渲染 null 且不打包 cloud 代码。
 */

import { isCloudBuildEnabled } from "@/shared/feature-flags";
import { lazy, Suspense } from "react";

/** 云服务是否编入本构建。宿主 UI 需要按形态增减入口时读它。 */
export const cloudEnabled = isCloudBuildEnabled();

const LazyAuthBoot = cloudEnabled
	? lazy(() => import("@cloud/auth/mount").then((m) => ({ default: m.CloudAuthBoot })))
	: null;

const LazyLoginPopover = cloudEnabled
	? lazy(() => import("@cloud/auth/mount").then((m) => ({ default: m.CloudLoginPopover })))
	: null;

const LazyLoginStep = cloudEnabled
	? lazy(() => import("@cloud/auth/mount").then((m) => ({ default: m.CloudLoginStep })))
	: null;

/** 云会话生命周期（登录态引导 / OAuth 回调 / SSE / 订阅）。挂在 App 根部，只挂一次。 */
export function CloudAuthBoot(): JSX.Element | null {
	if (!LazyAuthBoot) return null;
	return (
		<Suspense fallback={null}>
			<LazyAuthBoot />
		</Suspense>
	);
}

/** 授权登录浮层：与设置菜单同锚在侧边栏底部。lite 构建渲染 null。 */
export function CloudLoginPopover(): JSX.Element | null {
	if (!LazyLoginPopover) return null;
	return (
		<Suspense fallback={null}>
			<LazyLoginPopover />
		</Suspense>
	);
}

/** 引导向导的登录步。lite 构建下 steps 列表不含 login，本槽位不可达。 */
export function CloudLoginStep({ onSuccess }: { onSuccess: () => void }): JSX.Element | null {
	if (!LazyLoginStep) return null;
	return (
		<Suspense fallback={null}>
			<LazyLoginStep onSuccess={onSuccess} />
		</Suspense>
	);
}
