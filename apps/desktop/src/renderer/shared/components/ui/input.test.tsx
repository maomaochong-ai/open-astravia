// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input as SharedInput } from "@vetta/ui";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { Input } from "./input";

describe("Input", () => {
	it("keeps the Desktop entry on the shared component", () => {
		expect(Input).toBe(SharedInput);
	});

	it("forwards native input attributes, events and the focus ref", async () => {
		const user = userEvent.setup();
		const ref = createRef<HTMLInputElement>();
		const onChange = vi.fn();
		render(
			<Input
				ref={ref}
				autoFocus
				type="search"
				aria-label="Query"
				placeholder="Search"
				maxLength={3}
				onChange={(event) => onChange(event.target.value)}
			/>,
		);
		const input = screen.getByRole("searchbox", { name: "Query" });
		expect(ref.current).toBe(input);
		expect(document.activeElement).toBe(input);
		expect(input.getAttribute("placeholder")).toBe("Search");
		await user.type(input, "abcd");
		expect(ref.current?.value).toBe("abc");
		expect(onChange).toHaveBeenLastCalledWith("abc");
	});

	it("preserves controlled values and prevents edits while disabled or read-only", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		const { rerender } = render(<Input aria-label="Name" value="First" onChange={onChange} disabled />);
		const input = screen.getByRole("textbox", { name: "Name" });
		await user.type(input, "edit");
		expect(onChange).not.toHaveBeenCalled();
		rerender(<Input aria-label="Name" value="Second" onChange={onChange} readOnly />);
		expect(screen.getByDisplayValue("Second")).toBe(input);
		await user.type(input, "edit");
		expect(onChange).not.toHaveBeenCalled();
	});
});
