import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export type { ClassValue };

export function cn(...parts: ClassValue[]): string {
	return twMerge(clsx(parts));
}

/**
 * 所有弹出层（Dialog、Drawer、Splash、确认框等）蒙层的统一样式：淡色压暗 + 模糊背景。
 * 新增弹出层请直接用它，不要再各写一套，否则不同弹窗的蒙层会越长越分叉。
 *
 * 其中的 `overlay-backdrop` 是给全局样式用的标记类：macOS 经典侧边栏为透出原生毛玻璃而
 * 半透明，backdrop-filter 模糊出来的结果也是半透明的，会盖不住底下清晰的文字；styles.css
 * 在有蒙层时把侧边栏临时换成实色。
 */
export const OVERLAY_BACKDROP_CLASS = "overlay-backdrop bg-black/20 backdrop-blur-md";

/**
 * 浮层面板（Dialog、Splash）统一的柔和外投影：用两层低透明度的影子托起面板，
 * 代替边框线。影子越大越淡越容易发灰发脏，所以宁小勿大。
 */
export const PANEL_SHADOW_CLASS = "shadow-[0_16px_40px_-12px_rgb(0_0_0/0.10),0_2px_8px_-2px_rgb(0_0_0/0.05)]";

/**
 * 所有下拉 / 弹出面板（Popover、DropdownMenu、Select 的内容面）的统一外观：
 * 无外边框、大圆角、共用柔和投影。三个基础组件都从这里取，调用方不要再自己写
 * `border` / `rounded-*` / `shadow-*`，否则会和全局风格分叉。
 *
 * 深色模式下投影几乎看不见，面板底色又与页面背景只差十几档灰阶，没有边框就会糊在一起，
 * 所以深色补一圈极淡的 1px 描边（浅色模式仍然无线）。
 */
export const FLOATING_SURFACE_CLASS = `rounded-2xl bg-popover text-popover-foreground dark:ring-1 dark:ring-white/10 ${PANEL_SHADOW_CLASS}`;
