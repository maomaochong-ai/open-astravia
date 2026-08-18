/**
 * renderer 侧 Vetta 云服务 UI 入口。
 *
 * 宿主只允许经 `@shared/components/cloud-slots` 懒加载本模块——
 * lite 构建（VETTA_CLOUD_ENABLED=false）经常量折叠后整个 chunk 不进产物，
 * 所以宿主代码不得静态 import `@cloud/**`。
 */

import { useThemeComponent } from "@vetta/theme-sdk";
import { LoginPopover } from "./components/LoginPopover";
import { useAuth } from "./hooks/useAuth";

export { LoginStep as CloudLoginStep } from "./components/LoginStep";

/**
 * 云会话生命周期宿主：token 引导、OAuth 回调落地、主动 refresh 调度、
 * SSE 连接与订阅拉取全部挂在这里，整棵 React 树只挂载一次（App 根部）。
 */
export function CloudAuthBoot(): null {
	useAuth();
	return null;
}

/** 授权登录浮层（含主题覆写），锚定在侧边栏底部设置菜单同一位置。 */
export function CloudLoginPopover(): JSX.Element {
	const ThemedLoginPopover = useThemeComponent("root.loginPopover", LoginPopover);
	return <ThemedLoginPopover />;
}
