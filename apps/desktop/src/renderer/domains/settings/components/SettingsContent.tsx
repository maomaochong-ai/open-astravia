import { cn } from "@shared/lib/utils";

export interface SettingsContentProps {
	children: React.ReactNode;
	rootClassName?: string;
	/**
	 * 内容自己占满并管理滚动（内嵌的插件工作区视图就是这种整页 surface）。
	 * 缺省由设置内容区滚动，与其它设置页一致。
	 */
	fill?: boolean;
}

export function SettingsContent({ children, rootClassName, fill = false }: SettingsContentProps): JSX.Element {
	return (
		<div
			className={cn(
				"no-scrollbar flex min-h-0 min-w-0 flex-1 flex-col bg-background",
				fill ? "overflow-hidden" : "overflow-y-auto",
				rootClassName,
			)}
		>
			{children}
		</div>
	);
}
