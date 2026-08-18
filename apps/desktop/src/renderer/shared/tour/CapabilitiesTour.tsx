import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
	CAPABILITIES_TOUR_STORAGE_KEY,
	TOUR_ANCHORS,
	tourSelector,
} from "./constants";
import { runProductTour, waitForTourAnchor } from "./runTour";
import { isTourCompleted } from "./storage";

/** Module lock: survives StrictMode remount within the same page load. */
let capabilitiesTourLaunchLocked = false;

/**
 * First visit to the capabilities page: 4-step explanation tour.
 * Click Next to advance; completed state is stored in localStorage.
 */
export function CapabilitiesTour(): null {
	const { t } = useTranslation(["skills", "common"]);

	useEffect(() => {
		if (capabilitiesTourLaunchLocked || isTourCompleted(CAPABILITIES_TOUR_STORAGE_KEY)) return;

		let cancelled = false;
		const start = async () => {
			const banner = await waitForTourAnchor(tourSelector(TOUR_ANCHORS.capabilitiesBanner));
			if (cancelled || !banner) return;

			await new Promise((r) => window.setTimeout(r, 320));
			if (cancelled || capabilitiesTourLaunchLocked) return;
			if (isTourCompleted(CAPABILITIES_TOUR_STORAGE_KEY)) return;

			capabilitiesTourLaunchLocked = true;
			runProductTour({
				storageKey: CAPABILITIES_TOUR_STORAGE_KEY,
				labels: {
					next: t("common:tour.next"),
					prev: t("common:tour.prev"),
					done: t("common:tour.done"),
					progress: t("common:tour.progress"),
				},
				steps: [
					{
						element: tourSelector(TOUR_ANCHORS.capabilitiesBanner),
						popover: {
							title: t("skills:tour.capabilities.banner.title"),
							description: t("skills:tour.capabilities.banner.description"),
							side: "bottom",
							align: "start",
						},
					},
					{
						element: tourSelector(TOUR_ANCHORS.capabilitiesSearchAdd),
						popover: {
							title: t("skills:tour.capabilities.searchAdd.title"),
							description: t("skills:tour.capabilities.searchAdd.description"),
							side: "bottom",
							align: "start",
						},
					},
					{
						element: tourSelector(TOUR_ANCHORS.capabilitiesScope),
						popover: {
							title: t("skills:tour.capabilities.scope.title"),
							description: t("skills:tour.capabilities.scope.description"),
							side: "bottom",
							align: "end",
						},
					},
					{
						element: tourSelector(TOUR_ANCHORS.capabilitiesList),
						popover: {
							title: t("skills:tour.capabilities.list.title"),
							description: t("skills:tour.capabilities.list.description"),
							side: "top",
							align: "center",
						},
					},
				],
			});
		};

		const timer = window.setTimeout(() => {
			void start();
		}, 400);

		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [t]);

	return null;
}
