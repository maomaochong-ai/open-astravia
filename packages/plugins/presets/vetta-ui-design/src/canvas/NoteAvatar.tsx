/**
 * 备注参与者头像：用户与 Vetta 两种。
 *
 * 宿主 SDK 不提供真实头像，所以两个都是画出来的，靠形状而不是颜色区分——气泡本身
 * 已经在用颜色表达状态（蓝=待处理 / 绿=已处理），头像再带一套颜色就打架了。
 * Vetta 用的是插件里既有的机器人形象（`.vetd-bot` 那套圆头双眼），不另造一个。
 */

interface NoteAvatarProps {
	author: "user" | "agent";
	/** 头像直径（px）。 */
	size: number;
	/** 画在深色气泡里时反白；默认吃当前文字色。 */
	tone?: "solid" | "onColor";
}

export function NoteAvatar({ author, size, tone = "solid" }: NoteAvatarProps) {
	const onColor = tone === "onColor";
	if (author === "agent") {
		return (
			<span
				className="vetd-note-face shrink-0"
				style={{
					width: size,
					height: size,
					// 脸是白底、五官取 currentColor：放在绿色气泡里就是绿眼睛白脸。
					color: onColor ? "var(--vetd-note-resolved, #10b981)" : "var(--muted-foreground, #71717a)",
					background: onColor ? "#ffffff" : "color-mix(in oklab, var(--foreground, #000) 10%, transparent)",
				}}
				aria-hidden
			/>
		);
	}
	return (
		<span
			className="flex shrink-0 items-center justify-center rounded-full"
			style={{
				width: size,
				height: size,
				background: onColor ? "color-mix(in oklab, #fff 92%, transparent)" : "color-mix(in oklab, var(--foreground, #000) 10%, transparent)",
				color: onColor ? "var(--vetd-note-pending, #2563eb)" : "var(--muted-foreground, #71717a)",
			}}
			aria-hidden
		>
			<svg viewBox="0 0 24 24" style={{ width: size * 0.62, height: size * 0.62 }} fill="currentColor">
				<circle cx="12" cy="8.2" r="3.6" />
				<path d="M4.8 20.4a7.2 7.2 0 0114.4 0 1 1 0 01-1 1.1H5.8a1 1 0 01-1-1.1z" />
			</svg>
		</span>
	);
}

interface NotePinProps {
	resolved: boolean;
	/** pin 外径（px）。 */
	size: number;
	/** 待处理备注的编号，挂右上角；已处理传 null。 */
	number: number | null;
}

/**
 * 备注 pin 的视觉本体：状态色 + 头像 + 编号徽标。
 *
 * 画布气泡与抽屉列表共用同一个组件，抽屉里那一行因此长得就是画布上那个气泡的
 * 缩小版——两边是同一个对象，不需要再靠色条之类的第二套编码去暗示对应关系。
 * 定位、缩放、交互与完成动效都留给外层，这里只管长相。
 */
export function NotePin({ resolved, size, number }: NotePinProps) {
	return (
		<span
			className={`vetd-note-pin relative flex items-center justify-center rounded-full rounded-bl-[4px] ${
				resolved ? "vetd-note-pin-resolved" : ""
			}`}
			style={{ width: size, height: size }}
		>
			<NoteAvatar author={resolved ? "agent" : "user"} size={Math.round(size * 0.72)} tone="onColor" />
			{number !== null ? (
				<span
					className="absolute -right-1 -top-1 flex items-center justify-center rounded-full font-semibold tabular-nums text-[var(--vetd-note-pending,#2563eb)]"
					style={{
						minWidth: Math.round(size * 0.5),
						paddingInline: 3,
						fontSize: Math.max(9, Math.round(size * 0.32)),
						lineHeight: `${Math.round(size * 0.5)}px`,
						background: "#fff",
						boxShadow: "0 1px 3px -1px rgba(0,0,0,.4)",
					}}
				>
					{number}
				</span>
			) : null}
		</span>
	);
}
