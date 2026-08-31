// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DatePickerProps } from "@vetta/ui";
import { Calendar as SharedCalendar, CalendarDayButton as SharedDayButton, DatePicker } from "@vetta/ui";
import { useState } from "react";
import { enUS, zhCN } from "react-day-picker/locale";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/shared/i18n/locales/en/project.json";
import zh from "@/shared/i18n/locales/zh/project.json";
import { Calendar, CalendarDayButton } from "./calendar";

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 7, 31, 14));
	HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.useRealTimers());

function mountPicker(overrides: Partial<DatePickerProps> = {}) {
	const onChange = vi.fn();
	const onSubmit = vi.fn();
	function Harness() {
		const [value, setValue] = useState(overrides.value);
		return (
			<form
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit();
				}}
			>
				<DatePicker
					label="Date"
					labels={en.sidebar.search.calendar}
					locale={enUS}
					{...overrides}
					value={value}
					onChange={(date) => {
						onChange(date);
						setValue(date);
					}}
				/>
			</form>
		);
	}
	const view = render(<Harness />);
	return {
		refresh: () => view.rerender(<Harness />),
		user: userEvent.setup(),
		onChange,
		onSubmit,
		trigger: screen.getByRole("button", { name: overrides.label ?? "Date" }),
	};
}

describe("shared DatePicker", () => {
	it("does not steal navigation focus when streaming results rerender its parent", async () => {
		const { user, trigger, refresh } = mountPicker({ value: new Date(2026, 7, 20) });
		await user.click(trigger);
		const year = screen.getByRole("combobox", { name: "Year" });
		year.focus();
		refresh();
		expect(document.activeElement).toBe(year);
	});
	it("preserves the existing Desktop Calendar exports", () => {
		expect(Calendar).toBe(SharedCalendar);
		expect(CalendarDayButton).toBe(SharedDayButton);
	});

	it("focuses the selected day, selects with the keyboard and clears without submitting the form", async () => {
		const { user, trigger, onChange, onSubmit } = mountPicker({ value: new Date(2026, 7, 20) });
		await user.click(trigger);
		const selected = screen.getByRole("button", { name: "Thursday, August 20, 2026, Selected" });
		await waitFor(() => expect(document.activeElement).toBe(selected));
		await user.keyboard("{ArrowRight}{Enter}");
		expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 7, 21));
		await waitFor(() => expect(document.activeElement).toBe(trigger));
		expect(trigger.textContent).toContain("Aug 21, 2026");
		await user.click(trigger);
		await user.click(screen.getByRole("button", { name: "Clear date" }));
		expect(onChange).toHaveBeenLastCalledWith(undefined);
		expect(trigger.textContent).toContain("Pick a date");
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("uses themed month/year menus, bounds the year menu, and selects a leap day", async () => {
		const { user, trigger, onChange } = mountPicker();
		await user.click(trigger);
		const month = screen.getByRole("combobox", { name: "Month" });
		fireEvent.keyDown(month, { key: "Enter" });
		await user.click(screen.getByRole("option", { name: "February" }));
		const year = screen.getByRole("combobox", { name: "Year" });
		fireEvent.keyDown(year, { key: "Enter" });
		expect(screen.getAllByRole("option").length).toBeLessThanOrEqual(101);
		await user.click(screen.getByRole("option", { name: "2024" }));
		expect(screen.getByRole("grid", { name: "February 2024" })).toBeTruthy();
		expect(onChange).not.toHaveBeenCalled();
		expect(document.querySelector('input[type="date"]')).toBeNull();
		await user.click(screen.getByRole("button", { name: "Thursday, February 29, 2024" }));
		expect(onChange).toHaveBeenLastCalledWith(new Date(2024, 1, 29));
	});

	it("keeps Escape local to the year menu and then the calendar, restoring focus in order", async () => {
		const { user, trigger, onChange } = mountPicker();
		await user.click(trigger);
		const year = screen.getByRole("combobox", { name: "Year" });
		fireEvent.keyDown(year, { key: "Enter" });
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("listbox")).toBeNull();
		expect(screen.getByRole("dialog", { name: "Date" })).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(year));
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog")).toBeNull();
		await waitFor(() => expect(document.activeElement).toBe(trigger));
		expect(onChange).not.toHaveBeenCalled();
	});

	it("enforces inclusive boundaries on days, navigation and Today, allowing a same-day range", async () => {
		const date = new Date(2026, 7, 20);
		const { user, trigger, onChange } = mountPicker({ minDate: date, maxDate: date });
		await user.click(trigger);
		for (const name of [
			"Wednesday, August 19, 2026",
			"Friday, August 21, 2026",
			"Previous month",
			"Next month",
			"Today",
		]) {
			const button = screen.getByRole("button", { name });
			expect(button.hasAttribute("disabled")).toBe(true);
			await user.click(button);
		}
		expect(onChange).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "Thursday, August 20, 2026" }));
		expect(onChange).toHaveBeenLastCalledWith(date);
	});

	it("interprets bounds as dates, ignoring their time-of-day for Today", async () => {
		const { user, trigger, onChange } = mountPicker({
			minDate: new Date(2026, 7, 31, 14),
			maxDate: new Date(2026, 7, 31, 23),
		});
		await user.click(trigger);
		const today = screen.getByRole("button", { name: "Today" });
		expect(today.hasAttribute("disabled")).toBe(false);
		await user.click(today);
		expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 7, 31));
	});

	it("navigates across year boundaries without changing the value, and reopens on the selection", async () => {
		const { user, trigger, onChange } = mountPicker({ value: new Date(2025, 11, 31) });
		await user.click(trigger);
		await user.click(screen.getByRole("button", { name: "Next month" }));
		expect(screen.getByRole("grid", { name: "January 2026" })).toBeTruthy();
		expect(onChange).not.toHaveBeenCalled();
		await user.keyboard("{Escape}");
		await user.click(trigger);
		expect(screen.getByRole("grid", { name: "December 2025" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Today" }));
		expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 7, 31));
	});

	it("localizes calendar navigation, dates, weekdays and selection labels in Chinese", async () => {
		const { user, trigger, onChange } = mountPicker({
			label: "开始日期",
			labels: zh.sidebar.search.calendar,
			locale: zhCN,
		});
		await user.click(trigger);
		const grid = screen.getByRole("grid", { name: "2026年8月" });
		expect(screen.getByRole("combobox", { name: "月份" }).textContent).toContain("八月");
		expect(within(grid).getByText("一")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "2026年8月20日星期四" }));
		expect(onChange).toHaveBeenLastCalledWith(new Date(2026, 7, 20));
		await user.click(trigger);
		expect(screen.getByRole("button", { name: "2026年8月20日星期四, 已选择" })).toBeTruthy();
	});
});
