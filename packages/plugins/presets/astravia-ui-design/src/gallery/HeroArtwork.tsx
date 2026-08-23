/**
 * 画廊 Hero 的插画：一面「挂着设计稿的墙」。
 *
 * 全部用当前主题的语义色画（primary 取低透明度，其余走 currentColor），不写死任何
 * 色值——mono 之类的中性主题下它会自然退化成一组灰阶画框，而不是突兀的彩色贴纸。
 * 纯装饰，`aria-hidden`；窄屏由调用方直接不渲染。
 */
export function HeroArtwork({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 280 168"
			fill="none"
			aria-hidden
			// 左右两缘渐隐，插画像是「浮在」页面里而不是被边界裁断；
			// 顶端不裁——尺寸由调用方限制在 Hero 内，任何硬裁切线都是割裂感的来源
			style={{
				maskImage: "linear-gradient(to right, transparent, #000 22%, #000 88%, transparent)",
				WebkitMaskImage: "linear-gradient(to right, transparent, #000 22%, #000 88%, transparent)",
			}}
		>
			<title>gallery</title>
			{/* 后排两幅：更小、更淡，制造纵深 */}
			<g opacity="0.45">
				<rect
					x="14"
					y="34"
					width="66"
					height="86"
					rx="7"
					fill="currentColor"
					fillOpacity="0.04"
					stroke="currentColor"
					strokeOpacity="0.18"
				/>
				<rect x="24" y="46" width="34" height="4" rx="2" fill="currentColor" fillOpacity="0.28" />
				<rect x="24" y="56" width="46" height="4" rx="2" fill="currentColor" fillOpacity="0.16" />
				<rect x="24" y="70" width="46" height="34" rx="4" fill="var(--primary)" fillOpacity="0.16" />
			</g>

			{/* 主画框：内容更完整，边框最实 */}
			<g className="astd-hero-frame">
				<rect
					x="92"
					y="18"
					width="94"
					height="126"
					rx="9"
					fill="var(--card)"
					stroke="currentColor"
					strokeOpacity="0.28"
				/>
				<rect x="104" y="32" width="42" height="5" rx="2.5" fill="currentColor" fillOpacity="0.42" />
				<rect x="104" y="44" width="64" height="4" rx="2" fill="currentColor" fillOpacity="0.18" />
				<rect x="104" y="58" width="70" height="42" rx="5" fill="var(--primary)" fillOpacity="0.22" />
				<circle cx="118" cy="79" r="7" fill="var(--primary)" fillOpacity="0.55" />
				<rect x="132" y="74" width="34" height="4" rx="2" fill="currentColor" fillOpacity="0.22" />
				<rect x="132" y="83" width="24" height="4" rx="2" fill="currentColor" fillOpacity="0.14" />
				<rect x="104" y="110" width="30" height="12" rx="6" fill="var(--primary)" fillOpacity="0.5" />
				<rect x="140" y="110" width="34" height="12" rx="6" fill="currentColor" fillOpacity="0.1" />
			</g>

			{/* 前排小卡：略微倾斜，压住主画框右下角 */}
			<g transform="rotate(7 224 96)">
				<rect
					x="196"
					y="52"
					width="62"
					height="84"
					rx="8"
					fill="var(--card)"
					stroke="currentColor"
					strokeOpacity="0.2"
				/>
				<rect x="206" y="64" width="30" height="4" rx="2" fill="currentColor" fillOpacity="0.3" />
				<rect x="206" y="76" width="42" height="30" rx="4" fill="currentColor" fillOpacity="0.08" />
				<circle cx="214" cy="118" r="4" fill="var(--primary)" fillOpacity="0.45" />
				<circle cx="226" cy="118" r="4" fill="currentColor" fillOpacity="0.2" />
				<circle cx="238" cy="118" r="4" fill="currentColor" fillOpacity="0.12" />
			</g>

			{/* 漂浮点缀：给静止的墙一点空气感 */}
			<circle className="astd-hero-mote" cx="74" cy="18" r="3" fill="var(--primary)" fillOpacity="0.5" />
			<circle className="astd-hero-mote astd-hero-mote-slow" cx="252" cy="30" r="2" fill="currentColor" fillOpacity="0.3" />
		</svg>
	);
}
