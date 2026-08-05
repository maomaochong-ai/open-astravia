# Interaction & navigation

Read this when wiring clicks, building a multi-screen flow, or deciding whether
a design needs `frames/_layout.tsx`.

## Routing

One frame = one route, derived from the file name. `frames/login.tsx` → `/login`.
`frames/index.tsx` is the site root `/`; without it, `/` redirects to the first
frame. For any multi-screen product, make the entry screen `index.tsx`.

Navigate with react-router — it is installed in the engine:

```tsx
import { Link, useNavigate } from "react-router";

<Link to="/dashboard">登录</Link>;

// when the click does something first:
const navigate = useNavigate();
<button type="button" onClick={() => { save(); navigate("/dashboard"); }}>登录</button>;
```

Do NOT redefine `Link`/`useLocation`/`useNavigate` locally, and do NOT use
`<a href="/dashboard">` for an internal screen — a bare anchor forces a full
page reload, which remounts the whole app and throws away any shared shell.

## Shared chrome: component or layout?

Two levels. Pick by whether the chrome must survive navigation.

- **A shared component** (`components/AppShell.tsx`, imported by each frame) is
  the default. Always right, costs nothing.
- **A layout route** (`frames/_layout.tsx`) becomes the parent route of every
  frame, so the nav bar mounts ONCE: expanded menus, active state and scroll
  position stay put when the user clicks through. Create it when the design is a
  real multi-screen app/site with persistent chrome. Files starting with `_` are
  not frames — no canvas artboard is created for them.

```tsx
// frames/_layout.tsx — must render <Outlet /> itself
import { Outlet, useLocation } from "react-router";
import { NavBar } from "../components/NavBar";

export default function Layout() {
	const { pathname } = useLocation();
	// Screens outside the app shell (login, onboarding, a full-bleed landing
	// page) opt out here — there is no separate mechanism for it.
	if (pathname === "/login") return <Outlet />;
	return (
		<div className="flex h-full flex-col bg-surface">
			<NavBar />
			<div className="min-h-0 flex-1">
				<Outlet />
			</div>
		</div>
	);
}
```

Do not create a layout for posters, slides, infographics or a single-screen
design — there is nothing to persist. No `_layout.tsx` means the engine behaves
exactly as if the concept did not exist.

Chrome differs per form factor (a 390-wide tab bar and a 1440-wide top nav are
not the same shell), so one layout file serves one form factor. Put
mixed-form-factor work in separate design documents.

## How much interaction to write

- **Mobile screen / desktop app / dashboard / landing page**: wire it up.
  `useState` for tabs, accordions, dropdowns, modals, form fields, toggles,
  filters; `<Link>`/`navigate()` for anything that moves between screens. When
  the user asked for a flow (login → home → detail), it must be clickable end to
  end.
- **Slide / poster / social image / infographic / chart**: no interaction. They
  are static artwork; state hooks there are pure noise.

Keep it honest and local: real component state, no fake backends, no timers
pretending to load forever. A submit button navigates to the next screen; it
does not need an API.

The canvas itself stays in design mode — clicking a frame there selects elements
for editing. Interaction is verified in 预览 (or by reading the code), not by
clicking the canvas.
