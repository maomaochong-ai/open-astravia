import { cn } from "@shared/lib/utils";
import "./AuroraTexture.css";

export interface AuroraTextureProps {
	readonly className?: string;
}

/**
 * 流光：新会话页正中那团流动的光晕，纹理之一。
 *
 * 只画光晕本身，居中摆在所在的定位容器里——半径、色斑尺度、点阵疏密与全部动效都在
 * AuroraTexture.css 里；换个尺寸（如设置页那枚预览方格）覆盖 `--ns-aurora-radius`
 * / `--ns-aurora-field-scale` / `--ns-aurora-cell` 即可。纯装饰，对辅助技术整体隐藏。
 *
 * 三层色斑是真实节点而不是伪元素：每层要各自用 transform 平移，才能只靠合成器动起来。
 * 别改回 filter / background-position 动画，原因见样式表开头的性能约束。
 */
export function AuroraTexture({ className }: AuroraTextureProps): JSX.Element {
	return (
		<div aria-hidden className={cn("ns-aurora", className)}>
			<div className="ns-aurora-blob ns-aurora-blob-a" />
			<div className="ns-aurora-blob ns-aurora-blob-b" />
			<div className="ns-aurora-blob ns-aurora-blob-c" />
			<div className="ns-aurora-field" />
		</div>
	);
}
