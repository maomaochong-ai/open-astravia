import { sidebarCollapsedAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
	isSetupWizardCompleted,
	SETUP_WIZARD_COMPLETED_EVENT,
} from "../setup-wizard/storage";
import {
	SIDEBAR_TOUR_STORAGE_KEY,
	TOUR_ANCHORS,
	tourSelector,
} from "./constants";
import { runProductTour, waitForTourAnchor } from "./runTour";
import { isTourCompleted } from "./storage";

/** Module lock: survives StrictMode remount within the same page load. */
let sidebarTourLaunchLocked = false;

interface SidebarTourProps {
	/** Narrow-screen overlay control so the docked/floating sidebar is visible. */
	onEnsureSidebarVisible?: () => void;
}

function waitForSetupWizardIfNeeded(): Promise<void> {
	if (isSetupWizardCompleted()) return Promise.resolve();
	return new Promise((resolve) => {
		const onDone = () => {
			window.removeEventListener(SETUP_WIZARD_COMPLETED_EVENT, onDone);
			resolve();
		};
		window.addEventListener(SETUP_WIZARD_COMPLETED_EVENT, onDone);
	});
}

/**
 * First-run sidebar tour: projects → conversations → capabilities nav.
 * Click Next to advance; completed state is stored in localStorage.
 * Waits until the setup wizard is dismissed so the two first-run UIs do not overlap.
 */
export function SidebarTour({ onEnsureSidebarVisible }: SidebarTourProps): null {
	const { t } = useTranslation(["project", "common"]);
	const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtom);

	useEffect(() => {
		if (sidebarTourLaunchLocked || isTourCompleted(SIDEBAR_TOUR_STORAGE_KEY)) return;

		let cancelled = false;
		const start = async () => {
			await waitForSetupWizardIfNeeded();
			if (cancelled) return;

			// Ensure sidebar is expanded / overlay open so anchors exist.
			setSidebarCollapsed(false);
			onEnsureSidebarVisible?.();

			const projects = await waitForTourAnchor(tourSelector(TOUR_ANCHORS.sidebarProjects));
			if (cancelled || !projects) return;

			// Small delay so layout settles after expand/open.
			await new Promise((r) => window.setTimeout(r, 280));
			if (cancelled || sidebarTourLaunchLocked) return;
			if (isTourCompleted(SIDEBAR_TOUR_STORAGE_KEY)) return;

			sidebarTourLaunchLocked = true;
			runProductTour({
				storageKey: SIDEBAR_TOUR_STORAGE_KEY,
				labels: {
					next: t("common:tour.next"),
					prev: t("common:tour.prev"),
					done: t("common:tour.done"),
					progress: t("common:tour.progress"),
				},
				steps: [
					{
						element: tourSelector(TOUR_ANCHORS.sidebarProjects),
						popover: {
							title: t("project:tour.sidebar.projects.title"),
							description: t("project:tour.sidebar.projects.description"),
							side: "right",
							align: "start",
						},
					},
					{
						element: tourSelector(TOUR_ANCHORS.sidebarConversations),
						popover: {
							title: t("project:tour.sidebar.conversations.title"),
							description: t("project:tour.sidebar.conversations.description"),
							side: "right",
							align: "center",
						},
					},
					{
						element: tourSelector(TOUR_ANCHORS.sidebarNavSkills),
						popover: {
							title: t("project:tour.sidebar.skills.title"),
							description: t("project:tour.sidebar.skills.description"),
							side: "right",
							align: "start",
						},
					},
				],
			});
		};

		const timer = window.setTimeout(() => {
			void start();
		}, 700);

		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [onEnsureSidebarVisible, setSidebarCollapsed, t]);

	return null;
}
