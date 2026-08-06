import {
	DefaultWindowControls,
	PageHeaderActionGroup,
	PageHeaderFrame,
	PageHeaderTitle,
	usePageHeaderModel,
	useWindowControlsModel,
} from "@vetta/desktop-theme-ui/app-shell";
import type { JSX } from "react";
import { sanctumPageAssets } from "./assets";

/**
 * Sanctum page top bar: back + title on the left, Windows controls on the right.
 * Window controls use light ink — default `text-foreground` is dark (xianxia is
 * a light scheme) and disappears against the night-sky sanctum background.
 */
export function XianxiaSanctumPageHeader(): JSX.Element {
	const pageHeader = usePageHeaderModel({ narrow: false, sidebarCollapsed: false });
	const windowControls = useWindowControlsModel();

	return (
		<PageHeaderFrame
			className="sticky top-0 z-20 h-20 w-full overflow-hidden pt-7 text-white drop-shadow-[0_2px_5px_rgba(15,23,42,0.7)]"
			contentClassName="min-w-0 items-start overflow-hidden"
			reserveMacTrafficLights={false}
			style={{ marginBottom: 0, paddingLeft: 32, paddingRight: 32 }}
			triggerVisible={false}
		>
			<div className="no-drag flex min-w-0 flex-1 items-start gap-3">
				<button
					type="button"
					aria-label="Back"
					title="Back"
					onClick={() => window.history.back()}
					className="group mt-0.5 h-10 w-10 rounded-md border border-transparent outline-none focus-visible:border-white/80"
				>
					<img
						alt=""
						aria-hidden="true"
						className="h-full w-full object-contain transition-transform duration-200 ease-out will-change-transform group-hover:-translate-x-1"
						src={sanctumPageAssets.backButton}
					/>
				</button>
				<div className="min-w-0">
					<PageHeaderTitle
						title={pageHeader.title}
						className="text-[31px] font-semibold leading-8 text-white"
					/>
					<p className="mt-1 text-[19px] leading-none text-white/90">修仙成就</p>
				</div>
			</div>
			<p className="pointer-events-none absolute left-1/2 top-[78px] hidden max-w-[42%] -translate-x-1/2 truncate text-[17px] text-white/90 xl:block">
				15 Realms of Cultivation · Forge your path, ascend to immortality
			</p>
			{!windowControls.isMac && (
				<PageHeaderActionGroup className="min-w-0 shrink-0 items-start overflow-visible">
					<DefaultWindowControls
						classNames={{
							button: "text-white/92 hover:bg-white/18 hover:text-white",
							closeButton: "hover:bg-red-500/90 hover:text-white",
							icon: "drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]",
						}}
						model={windowControls}
					/>
				</PageHeaderActionGroup>
			)}
		</PageHeaderFrame>
	);
}
