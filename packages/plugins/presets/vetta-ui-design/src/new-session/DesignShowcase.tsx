/**
 * 新会话页输入框下方的能力橱窗。
 *
 * 用户选了设计师，却未必知道这个搭档的射程有多远——只当它会画 App 界面的人，不会想到
 * 让它做海报或幻灯片。这里把能产出的东西直接画出来。
 *
 * 刻意做成纯展示：没有按钮、没有点击态。它出现在用户正要打字的那一刻，任何可点的东西
 * 都在跟输入框抢注意力；它的职责是让人知道「可以让它做这些」，然后继续打字。
 *
 * 缩略图是 CSS 画的抽象件，不是图标也不是截图：图标说不清产物长什么样，截图会随设计体系
 * 变化而过期。所有画板等高、按真实画幅定宽，连同底纹一起，让这一条读起来就是画布的一角。
 */
import { useTranslation } from "@vetta-org/plugin-sdk";
import type { CSSProperties, JSX, ReactNode } from "react";

/** 中性内容条：用前景色压到很低的透明度，明暗两套主题下都成立。 */
function Bar({ className }: { className: string }): JSX.Element {
	return <span className={`block rounded-[1px] bg-foreground/15 ${className}`} />;
}

/** 强调件：取宿主主题色，让橱窗跟着用户的配色走。 */
function Accent({ className, style }: { className: string; style?: CSSProperties }): JSX.Element {
	return <span className={`block rounded-[1px] bg-primary/75 ${className}`} style={style} />;
}

/** 画板外框：统一高度、圆角与投影，让六件东西看起来出自同一套系统。 */
function Artboard({ className, children }: { className: string; children?: ReactNode }): JSX.Element {
	return (
		<span
			className={`relative flex h-[60px] flex-col overflow-hidden rounded-[4px] border border-border/80 bg-background shadow-sm ${className}`}
		>
			{children}
		</span>
	);
}

/** 手机屏 390×844。 */
function MobileArt(): JSX.Element {
	return (
		<Artboard className="w-[28px] p-[4px]">
			<div className="flex items-center justify-between">
				<Bar className="h-[1.5px] w-[6px]" />
				<Bar className="h-[1.5px] w-[4px]" />
			</div>
			<Accent className="mt-[4px] h-[3px] w-[15px]" />
			<div className="mt-[4px] flex flex-col gap-[3px]">
				<Bar className="h-[10px] w-full" />
				<Bar className="h-[10px] w-full" />
			</div>
			<div className="mt-auto flex items-center justify-between border-t border-border/60 pt-[4px]">
				<Accent className="h-[3px] w-[3px] rounded-full" />
				<Bar className="h-[3px] w-[3px] rounded-full" />
				<Bar className="h-[3px] w-[3px] rounded-full" />
			</div>
		</Artboard>
	);
}

/** 桌面后台 1440×900。 */
function DashboardArt(): JSX.Element {
	return (
		<Artboard className="w-[96px] flex-row p-[5px]">
			<div className="flex w-[17px] shrink-0 flex-col gap-[3px] border-r border-border/60 pr-[4px]">
				<Accent className="h-[3px] w-[10px]" />
				<Bar className="h-[2px] w-full" />
				<Bar className="h-[2px] w-full" />
				<Bar className="h-[2px] w-[11px]" />
				<Bar className="h-[2px] w-full" />
			</div>
			<div className="flex flex-1 flex-col gap-[3px] pl-[5px]">
				<div className="flex gap-[3px]">
					<Bar className="h-[12px] flex-1" />
					<Bar className="h-[12px] flex-1" />
					<Accent className="h-[12px] flex-1 opacity-40" />
				</div>
				<div className="flex flex-1 items-end gap-[3px]">
					{["38%", "64%", "50%", "88%", "42%", "70%"].map((height, index) => (
						<Accent
							// biome-ignore lint/suspicious/noArrayIndexKey: 纯装饰柱形，位置即身份
							key={index}
							className="flex-1 rounded-b-none"
							style={{ height }}
						/>
					))}
				</div>
			</div>
		</Artboard>
	);
}

/** 落地页 1440×2400。 */
function LandingArt(): JSX.Element {
	return (
		<Artboard className="w-[36px] p-[4px]">
			<div className="flex items-center justify-between">
				<Accent className="h-[2.5px] w-[8px]" />
				<Bar className="h-[1.5px] w-[11px]" />
			</div>
			<div className="mt-[7px] flex flex-col items-center gap-[3px]">
				<Bar className="h-[4px] w-[28px]" />
				<Bar className="h-[4px] w-[19px]" />
				<Bar className="h-[2px] w-[24px] opacity-70" />
				<Accent className="mt-[2px] h-[5px] w-[16px] rounded-full" />
			</div>
			<div className="mt-auto flex gap-[3px]">
				<Bar className="h-[13px] flex-1 opacity-70" />
				<Bar className="h-[13px] flex-1 opacity-70" />
				<Bar className="h-[13px] flex-1 opacity-70" />
			</div>
		</Artboard>
	);
}

/** 幻灯片 1920×1080。 */
function SlideArt(): JSX.Element {
	return (
		<Artboard className="w-[107px] flex-row gap-[7px] p-[6px]">
			<div className="flex flex-1 flex-col justify-center gap-[3px]">
				<Accent className="h-[4px] w-[32px]" />
				<Bar className="h-[2.5px] w-[42px]" />
				<Bar className="h-[2.5px] w-[27px]" />
				<div className="mt-[4px] flex gap-[3px]">
					<Bar className="h-[2px] w-[9px] opacity-70" />
					<Bar className="h-[2px] w-[9px] opacity-70" />
				</div>
			</div>
			<span className="vetd-showcase-media block w-[44px] shrink-0 self-stretch rounded-[3px]" />
		</Artboard>
	);
}

/** 海报 1080×1440。 */
function PosterArt(): JSX.Element {
	return (
		<Artboard className="w-[45px]">
			<span aria-hidden="true" className="vetd-showcase-poster absolute inset-0" />
			<span className="absolute right-[6px] top-[6px] h-[11px] w-[11px] rounded-full bg-background/80" />
			<div className="relative mt-auto flex flex-col gap-[2.5px] p-[5px]">
				<span className="block h-[5px] w-[28px] rounded-[1px] bg-background/90" />
				<span className="block h-[5px] w-[18px] rounded-[1px] bg-background/90" />
				<span className="mt-[1px] block h-[1.5px] w-[23px] rounded-[1px] bg-background/60" />
			</div>
		</Artboard>
	);
}

/** 社交方图 1080×1080。 */
function SquareArt(): JSX.Element {
	return (
		<Artboard className="w-[60px] p-[5px]">
			<span aria-hidden="true" className="absolute inset-0 bg-primary/10" />
			<div className="relative flex flex-1 flex-col items-center justify-center gap-[4px]">
				<span className="vetd-showcase-tile block h-[16px] w-[16px] rounded-[4px]" />
				<Bar className="h-[3px] w-[30px] opacity-100" />
				<Bar className="h-[2px] w-[20px] opacity-70" />
			</div>
		</Artboard>
	);
}

const ITEMS: readonly { readonly key: string; readonly art: JSX.Element }[] = [
	{ key: "mobile", art: <MobileArt /> },
	{ key: "dashboard", art: <DashboardArt /> },
	{ key: "landing", art: <LandingArt /> },
	{ key: "slide", art: <SlideArt /> },
	{ key: "poster", art: <PosterArt /> },
	{ key: "square", art: <SquareArt /> },
];

export function DesignShowcase(): JSX.Element {
	const { t } = useTranslation();

	return (
		<div className="vetd-showcase-grid relative overflow-hidden rounded-[9px] border border-border/40">
			<span aria-hidden="true" className="vetd-showcase-wash pointer-events-none absolute inset-0" />
			<div className="relative px-3.5 pb-3 pt-2.5">
				<div className="flex items-baseline gap-2">
					<span className="text-[12px] font-semibold tracking-tight text-foreground">
						{t("newSession.showcase.title")}
					</span>
					<span className="truncate text-[11px] text-muted-foreground">{t("newSession.showcase.subtitle")}</span>
				</div>

				<ul className="mt-3 flex list-none flex-wrap items-end justify-between gap-x-3.5 gap-y-3.5 p-0">
					{ITEMS.map((item) => (
						<li key={item.key} className="flex flex-col items-center gap-[7px]">
							{item.art}
							<span className="whitespace-nowrap text-[10px] leading-none text-muted-foreground">
								{t(`newSession.showcase.${item.key}`)}
							</span>
						</li>
					))}
				</ul>

				<p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/85">
					{t("newSession.showcase.footnote")}
				</p>
			</div>
		</div>
	);
}
