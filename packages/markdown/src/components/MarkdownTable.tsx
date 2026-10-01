import type { ComponentPropsWithoutRef } from "react";

/** 宽表格在自己的容器里横向滚动，避免撑破正文栏宽导致整页横向滚动。 */
export function MarkdownTable({ children, ...rest }: ComponentPropsWithoutRef<"table">) {
	return (
		<div className="astravia-markdown-table-scroll">
			<table {...rest}>{children}</table>
		</div>
	);
}
