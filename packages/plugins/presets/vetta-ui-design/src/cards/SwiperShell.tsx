import { type ReactNode, useEffect, useRef, useState } from "react";

function Chevron({ dir }: { dir: "left" | "right" }) {
	return (
		<svg
			viewBox="0 0 24 24"
			className="h-4 w-4"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
		</svg>
	);
}

/** 两端渐隐遮罩：提示该侧还有更多内容可翻。 */
function EdgeFade({ dir }: { dir: "left" | "right" }) {
	return (
		<div
			aria-hidden
			className={`pointer-events-none absolute inset-y-0 z-[5] w-10 ${dir === "left" ? "left-0" : "right-0"}`}
			style={{ background: `linear-gradient(to ${dir === "left" ? "right" : "left"}, var(--background), transparent)` }}
		/>
	);
}

function ArrowButton({
	dir,
	visible,
	title,
	onClick,
}: {
	dir: "left" | "right";
	visible: boolean;
	title: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			className={`absolute top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-white/90 backdrop-blur-md transition-all hover:text-white ${dir === "left" ? "left-0" : "right-0"}`}
			style={{
				background: "color-mix(in oklab, black 48%, transparent)",
				opacity: visible ? 1 : 0,
				pointerEvents: visible ? "auto" : "none",
			}}
		>
			<Chevron dir={dir} />
		</button>
	);
}

/**
 * 会话卡片里的横向翻页容器：滚动条隐藏，溢出时两端出现渐隐遮罩与 hover 箭头，
 * 点击箭头翻动一整屏。内容尺寸变化（图片加载完、条目增减）由 ResizeObserver 重测。
 */
export function SwiperShell({
	children,
	prevLabel,
	nextLabel,
	resetKey,
	className,
}: {
	children: ReactNode;
	prevLabel: string;
	nextLabel: string;
	/** 变化时把视野滚回最左（例如新增了一版内容）。 */
	resetKey?: string | number;
	className?: string;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [canPrev, setCanPrev] = useState(false);
	const [canNext, setCanNext] = useState(false);
	const [hover, setHover] = useState(false);

	const measure = (): void => {
		const el = scrollRef.current;
		if (!el) return;
		setCanPrev(el.scrollLeft > 1);
		setCanNext(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
	};

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const observer = new ResizeObserver(() => measure());
		observer.observe(el);
		for (const child of Array.from(el.children)) observer.observe(child);
		return () => observer.disconnect();
	}, [resetKey]);

	useEffect(() => {
		measure();
		scrollRef.current?.scrollTo({ left: 0, behavior: "smooth" });
	}, [resetKey]);

	const scrollByView = (dir: -1 | 1): void => {
		const el = scrollRef.current;
		if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
	};

	return (
		<div className="relative" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
			<div
				ref={scrollRef}
				onScroll={measure}
				className={`vetd-swiper flex overflow-x-auto scroll-smooth ${className ?? ""}`}
			>
				{children}
			</div>
			{canPrev && (
				<>
					<EdgeFade dir="left" />
					<ArrowButton dir="left" visible={hover} title={prevLabel} onClick={() => scrollByView(-1)} />
				</>
			)}
			{canNext && (
				<>
					<EdgeFade dir="right" />
					<ArrowButton dir="right" visible={hover} title={nextLabel} onClick={() => scrollByView(1)} />
				</>
			)}
		</div>
	);
}
