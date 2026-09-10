import { cn } from "@shared/lib/utils";
import "./AuroraTexture.css";

export interface AuroraTextureProps {
	readonly className?: string;
}

/**
 * 流光：新会话页正中那团流动的光晕，纹理之一。
 *
 * 只画光晕本身，铺满所在的定位容器——半径、模糊、点阵疏密与全部动效都在
 * AuroraTexture.css 里；换个尺寸（如设置页那枚预览方格）覆盖 `--ns-aurora-radius`
 * / `--ns-aurora-blur` / `--ns-aurora-cell` 即可。纯装饰，对辅助技术整体隐藏。
 */
export function AuroraTexture({ className }: AuroraTextureProps): JSX.Element {
	return (
		<div aria-hidden className={cn("ns-aurora", className)}>
			<div className="ns-aurora-field" />
		</div>
	);
}
