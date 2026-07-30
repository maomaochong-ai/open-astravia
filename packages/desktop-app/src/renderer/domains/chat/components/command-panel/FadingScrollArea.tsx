import { useCallback, useEffect, useRef, useState } from "react";

/** 底部渐隐的高度：约一行的一半，够看出「下面被切掉了」又不吃掉整行。 */
const FADE_MASK = "[mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]";

/**
 * 隐藏原生滚动条、用底部渐隐表示「还没到底」的滚动容器。
 *
 * 渐隐用 mask 而不是叠一层渐变色块：命令区的底色由主题 surface 决定，
 * 写死 `from-card` 在换主题后会露出色差。
 * 只在真的还能往下滚时才挂 mask，否则内容不满一屏时最后一行会无端被淡掉。
 */
export function FadingScrollArea({
	children,
	className,
	suspended = false,
}: {
	children: React.ReactNode;
	className?: string;
	/**
	 * 暂时不挂 mask。展开动画期间用：mask 让这块无法复用光栅缓存，
	 * 每帧都要多合成一次，低配设备上是白花的开销。
	 */
	suspended?: boolean;
}): JSX.Element {
	const ref = useRef<HTMLDivElement>(null);
	const [fading, setFading] = useState(false);

	const sync = useCallback(() => {
		const el = ref.current;
		if (!el) return;
		setFading(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
	}, []);

	// 过滤词变化时列表高度会跳，光靠 onScroll 追不上，因此连内容一起观察。
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		sync();
		const observer = new ResizeObserver(sync);
		observer.observe(el);
		for (const child of Array.from(el.children)) observer.observe(child);
		return () => observer.disconnect();
	}, [sync]);

	return (
		<div
			ref={ref}
			onScroll={sync}
			className={[
				// 隐藏滚动条只能用 no-scrollbar：全局 overlay 滚动条规则是无 layer 的，
				// Tailwind 的 `[&::-webkit-scrollbar]:hidden` 在 layer 里压不过它。
				"no-scrollbar min-h-0 flex-1 overflow-y-auto",
				fading && !suspended ? FADE_MASK : "",
				className,
			]
				.filter(Boolean)
				.join(" ")}
		>
			{children}
		</div>
	);
}
