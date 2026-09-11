/**
 * 新会话页输入框下方的能力橱窗。
 *
 * 用户选了设计师，却未必知道这个搭档的射程有多远——只当它会画 App 界面的人，不会想到
 * 让它做海报或幻灯片。这里把能产出的东西直接画出来。
 *
 * 刻意做成纯展示：没有按钮、没有点击态。它出现在用户正要打字的那一刻，任何可点的东西
 * 都在跟输入框抢注意力；它的职责是让人知道「可以让它做这些」，然后继续打字。
 *
 * 整块不画一条描边：区域紧贴输入框，再套描边就成了「框里还有框」。画板靠极淡的填充浮在
 * 背景上，层次全由色调与留白给。缩略图是 CSS 抽象件而不是图标或截图——图标说不清产物长
 * 什么样，截图会随设计体系变化而过期；所有画板等高、按真实画幅定宽，画幅本身就是信息。
 */
import { useTranslation } from "@vetta-org/plugin-sdk";
import type { CSSProperties, JSX, ReactNode } from "react";

/** 中性内容条。 */
function Bar({ className, style }: { className: string; style?: CSSProperties }): JSX.Element {
	return <span className={`block rounded-[1px] bg-foreground/25 ${className}`} style={style} />;
}

/** 强调件：取宿主主题色，让橱窗跟着用户的配色走。 */
function Accent({ className, style }: { className: string; style?: CSSProperties }): JSX.Element {
	return <span className={`block rounded-[1px] bg-primary/80 ${className}`} style={style} />;
}

/** 画板：无描边，用一层极淡的填充把自己从背景里托起来。 */
function Artboard({ className, children }: { className: string; children?: ReactNode }): JSX.Element {
	return (
		<span className={`relative flex h-[68px] flex-col overflow-hidden rounded-[5px] bg-foreground/[0.06] ${className}`}>
			{children}
		</span>
	);
}

/** 手机屏 390×844。 */
function MobileArt(): JSX.Element {
	return (
		<Artboard className="w-[31px] p-[5px]">
			<div className="flex items-center justify-between">
				<Bar className="h-[1.5px] w-[7px]" />
				<Bar className="h-[1.5px] w-[4px]" />
			</div>
			<Accent className="mt-[5px] h-[3px] w-[17px]" />
			<div className="mt-[5px] flex flex-col gap-[4px]">
				<Bar className="h-[11px] w-full opacity-60" />
				<Bar className="h-[11px] w-full opacity-60" />
			</div>
			<div className="mt-auto flex items-center justify-between">
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
		<Artboard className="w-[109px] flex-row gap-[6px] p-[6px]">
			<div className="flex w-[18px] shrink-0 flex-col gap-[4px]">
				<Accent className="h-[3px] w-[11px]" />
				<Bar className="h-[2px] w-full opacity-60" />
				<Bar className="h-[2px] w-full opacity-60" />
				<Bar className="h-[2px] w-[12px] opacity-60" />
			</div>
			<div className="flex flex-1 flex-col gap-[4px]">
				<div className="flex gap-[4px]">
					<Bar className="h-[14px] flex-1 opacity-50" />
					<Bar className="h-[14px] flex-1 opacity-50" />
					<Accent className="h-[14px] flex-1 opacity-35" />
				</div>
				<div className="flex flex-1 items-end gap-[3px]">
					{["36%", "62%", "48%", "88%", "40%", "70%"].map((height, index) => (
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
		<Artboard className="w-[41px] p-[5px]">
			<div className="flex items-center justify-between">
				<Accent className="h-[2.5px] w-[9px]" />
				<Bar className="h-[1.5px] w-[12px] opacity-60" />
			</div>
			<div className="mt-[8px] flex flex-col items-center gap-[3px]">
				<Bar className="h-[4px] w-[31px]" />
				<Bar className="h-[4px] w-[21px]" />
				<Accent className="mt-[3px] h-[5px] w-[17px] rounded-full" />
			</div>
			<div className="mt-auto flex gap-[3px]">
				<Bar className="h-[15px] flex-1 opacity-45" />
				<Bar className="h-[15px] flex-1 opacity-45" />
				<Bar className="h-[15px] flex-1 opacity-45" />
			</div>
		</Artboard>
	);
}

/** 幻灯片 1920×1080。 */
function SlideArt(): JSX.Element {
	return (
		<Artboard className="w-[121px] flex-row gap-[8px] p-[8px]">
			<div className="flex flex-1 flex-col justify-center gap-[4px]">
				<Accent className="h-[4px] w-[36px]" />
				<Bar className="h-[2.5px] w-[48px] opacity-70" />
				<Bar className="h-[2.5px] w-[31px] opacity-70" />
				<div className="mt-[5px] flex gap-[4px]">
					<Bar className="h-[2px] w-[10px] opacity-50" />
					<Bar className="h-[2px] w-[10px] opacity-50" />
				</div>
			</div>
			<span className="vetd-showcase-media block w-[48px] shrink-0 self-stretch rounded-[4px]" />
		</Artboard>
	);
}

/** 海报 1080×1440。 */
function PosterArt(): JSX.Element {
	return (
		<Artboard className="w-[51px]">
			<span aria-hidden="true" className="vetd-showcase-poster absolute inset-0" />
			<span className="absolute right-[7px] top-[7px] h-[13px] w-[13px] rounded-full bg-background/80" />
			<div className="relative mt-auto flex flex-col gap-[3px] p-[6px]">
				<span className="block h-[5px] w-[32px] rounded-[1px] bg-background/90" />
				<span className="block h-[5px] w-[21px] rounded-[1px] bg-background/90" />
				<span className="mt-[2px] block h-[1.5px] w-[26px] rounded-[1px] bg-background/55" />
			</div>
		</Artboard>
	);
}

/** 社交方图 1080×1080。 */
function SquareArt(): JSX.Element {
	return (
		<Artboard className="w-[68px] p-[6px]">
			<div className="flex flex-1 flex-col items-center justify-center gap-[5px]">
				<span className="vetd-showcase-tile block h-[19px] w-[19px] rounded-[5px]" />
				<Bar className="h-[3px] w-[34px]" />
				<Bar className="h-[2px] w-[22px] opacity-60" />
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
		<div className="w-full">
			<p className="text-[11.5px] leading-none text-muted-foreground/70">{t("newSession.showcase.subtitle")}</p>

			<ul className="mt-4 flex list-none flex-wrap items-end justify-between gap-x-4 gap-y-5 p-0">
				{ITEMS.map((item) => (
					<li key={item.key} className="flex flex-col items-center gap-2">
						{item.art}
						<span className="whitespace-nowrap text-[10px] leading-none text-muted-foreground/60">
							{t(`newSession.showcase.${item.key}`)}
						</span>
					</li>
				))}
			</ul>

			<p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/50">{t("newSession.showcase.footnote")}</p>
		</div>
	);
}
