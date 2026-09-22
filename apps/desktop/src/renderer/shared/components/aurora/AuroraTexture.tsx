import { cn } from "@shared/lib/utils";
import "./AuroraTexture.css";

export interface AuroraTextureProps {
	readonly className?: string;
}

/**
 * 流光：新会话页正中那团半调网点的光晕，纹理之一。
 *
 * 只画光晕本身，居中摆在所在的定位容器里——半径、色斑尺度与点阵疏密都在
 * AuroraTexture.css 里；换个尺寸（如设置页那枚预览方格）覆盖 `--ns-aurora-radius`
 * / `--ns-aurora-field-scale` / `--ns-aurora-cell` 即可。纯装饰，对辅助技术整体隐藏。
 *
 * 这团光是静态的，别给它加动画，原因见样式表开头的性能约束。
 */
export function AuroraTexture({ className }: AuroraTextureProps): JSX.Element {
	return (
		<div aria-hidden className={cn("ns-aurora", className)}>
			<div className="ns-aurora-glow" />
			<div className="ns-aurora-field" />
		</div>
	);
}
