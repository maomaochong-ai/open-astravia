import type { JSX } from "react";

/** 保活页 / 详情页首帧标题壳：只画页身份，不铺脉冲骨架。 */
export function TitledPageShell({ title }: { title: string }): JSX.Element {
	return (
		<div className="relative flex h-full w-full flex-1 flex-col overflow-hidden">
			<div className="relative shrink-0 px-8 pb-4 pt-5">
				<h1 className="text-[26px] font-semibold leading-tight tracking-tight text-foreground">{title}</h1>
			</div>
		</div>
	);
}
