import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * portal 到 body 的浮层根。
 *
 * 插件 CSS 编译成 `@scope ([data-vetta-plugin-root=vetta-ui-design])`，而 @scope 里的
 * 选择器隐含的是「作用域根的**后代**」——根元素自身不匹配。于是带属性的那一层只能做
 * 作用域标记（display: contents，不参与布局），所有 Tailwind 类必须挂在它的子元素上。
 *
 * 这条约束此前踩过一次且极难查：宿主自己的 Tailwind 里恰好也有 `.fixed`/`.inset-0`/
 * `.z-[1000]`，把类写在根上看着一切正常；直到用上宿主没有的类（`z-[1010]`、
 * `max-h-[min(…)]`）才**只丢那一条**——设计资源的二次确认框因此拿不到 z-index，被
 * z-1000 的宫格整个盖住，表现为「点了应用只有蒙层变黑」。
 */
export function PluginPortal({ children }: { children: ReactNode }) {
	return createPortal(
		<div data-vetta-plugin-root="vetta-ui-design" style={{ display: "contents" }}>
			{children}
		</div>,
		document.body,
	);
}
