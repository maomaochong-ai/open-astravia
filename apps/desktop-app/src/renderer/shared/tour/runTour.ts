import { type Config, type DriveStep, driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./driver-theme.css";
import { isTourCompleted, markTourCompleted } from "./storage";

export interface TourLabels {
	next: string;
	prev: string;
	done: string;
	/** driver progress template, e.g. "{{current}} / {{total}}" */
	progress: string;
}

export interface RunTourOptions {
	storageKey: string;
	steps: DriveStep[];
	labels: TourLabels;
	/** Extra driver config overrides. */
	config?: Partial<Config>;
}

/**
 * Start a step-by-step product tour (Next / Prev / Done).
 * Marks localStorage complete on destroy (finish, close, or overlay dismiss).
 */
export function runProductTour(options: RunTourOptions): boolean {
	if (isTourCompleted(options.storageKey)) return false;

	const steps = options.steps.filter((step) => {
		if (typeof step.element !== "string") return true;
		return document.querySelector(step.element) != null;
	});
	if (steps.length === 0) return false;

	const instance = driver({
		animate: true,
		allowClose: true,
		overlayOpacity: 0.45,
		stagePadding: 6,
		stageRadius: 10,
		popoverOffset: 12,
		smoothScroll: true,
		showProgress: true,
		showButtons: ["next", "previous"],
		progressText: options.labels.progress,
		nextBtnText: options.labels.next,
		prevBtnText: options.labels.prev,
		doneBtnText: options.labels.done,
		popoverClass: "vetta-driver-popover",
		steps,
		onDestroyed: () => {
			markTourCompleted(options.storageKey);
		},
		...options.config,
	});

	instance.drive();
	return true;
}

/** Wait until at least one selector is present (or timeout). */
export function waitForTourAnchor(selector: string, timeoutMs = 4000): Promise<Element | null> {
	const existing = document.querySelector(selector);
	if (existing) return Promise.resolve(existing);

	return new Promise((resolve) => {
		const observer = new MutationObserver(() => {
			const el = document.querySelector(selector);
			if (el) {
				cleanup();
				resolve(el);
			}
		});
		const timer = window.setTimeout(() => {
			cleanup();
			resolve(document.querySelector(selector));
		}, timeoutMs);

		const cleanup = () => {
			observer.disconnect();
			window.clearTimeout(timer);
		};

		observer.observe(document.body, { childList: true, subtree: true });
	});
}
