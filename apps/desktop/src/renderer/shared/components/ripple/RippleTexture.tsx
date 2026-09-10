import { NEW_SESSION_TEXTURE_MASK, NewSessionAmbientGlow } from "@vetta/theme-ui/chat";

/**
 * 涟漪：一层同心圆环铺满整页，纹理之一。
 *
 * 与网格那档同构——共用同一条向外淡出的遮罩（NEW_SESSION_TEXTURE_MASK）与同一团
 * 环境光晕，差别只在纹路本身：
 * 网格是横竖直线，这里是每 6px 一圈的细环。两档换着看时页面重心不会跳。
 *
 * 圆环画的是「线」而不是「实心圆」：原始配方是 5px 实心 + 1px 空隙，铺开近乎一片实色，
 * 压在页面上会盖住内容；这里反过来留 5px 空、只描 1px 的环，重量与网格那条 1px 线一致。
 */
export function RippleTexture(): JSX.Element {
	return (
		<>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0"
				style={{
					backgroundImage:
						"repeating-radial-gradient(circle at 50% 50%, transparent 0 5px, color-mix(in srgb, var(--primary) 7%, transparent) 5px 6px)",
					backgroundSize: "20px 20px",
					backgroundPosition: "center center",
					// 与网格共用同一条淡出：各写各的迟早会漂，页面上就成了「换个纹理连
					// 重心和边缘都跟着变」。
					maskImage: NEW_SESSION_TEXTURE_MASK,
					WebkitMaskImage: NEW_SESSION_TEXTURE_MASK,
				}}
			/>

			<NewSessionAmbientGlow />
		</>
	);
}
