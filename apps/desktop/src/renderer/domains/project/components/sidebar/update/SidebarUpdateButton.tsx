import { Button } from "@astravia-org/ui/button";
import { useSidebarUpdateButtonModel } from "./useSidebarUpdateButtonModel";

/**
 * 侧栏底部的更新图标：有更新时才出现。
 * 实心圆箭头加一圈淡光环，在侧栏里一眼可见；下载中换成转圈的进度环，点它不会重复触发下载。
 */
export function SidebarUpdateButton(): JSX.Element | null {
	const model = useSidebarUpdateButtonModel();

	if (!model) return null;

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			disabled={model.downloading}
			onClick={model.onOpen}
			title={model.label}
			aria-label={model.label}
			className="no-drag hover:bg-transparent hover:opacity-80 disabled:opacity-100"
		>
			<span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm ring-4 ring-primary/20">
				<span
					className={
						model.downloading
							? "icon-[solar--refresh-circle-linear] h-3.5 w-3.5 animate-spin"
							: "icon-[solar--arrow-down-linear] h-3.5 w-3.5"
					}
				/>
			</span>
		</Button>
	);
}
