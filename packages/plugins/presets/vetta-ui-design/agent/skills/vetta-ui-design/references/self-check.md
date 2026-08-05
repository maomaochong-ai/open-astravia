# Structure self-check

Run this against your own output **before reporting back**, whenever the design
is a UI product (app screens / dashboard / website) with more than one screen,
or with chrome that repeats across screens — a nav bar, sidebar, tab bar or page
header.

Skip it entirely for posters, slides, infographics and single-screen designs.

## The shape it should have

```text
shop.vetd.d/
  frames/
    _layout.tsx            ← shell mounted once, renders <Outlet />
    index.tsx              ← "/"        composition only
    products.tsx           ← "/products"
    orders.tsx             ← "/orders"
    login.tsx              ← "/login"   opts out of the shell inside _layout
  components/
    NavBar.tsx             ← the chrome itself, written ONCE
    StatCard.tsx           ← blocks repeated across screens
    DataTable.tsx
  theme.css                ← every color/radius/shadow token
```

Minimal correct versions of each piece:

```tsx
// frames/_layout.tsx
import { Outlet, useLocation } from "react-router";
import { NavBar } from "../components/NavBar";

export default function Layout() {
	const { pathname } = useLocation();
	if (pathname === "/login") return <Outlet />;
	return (
		<div className="flex h-full flex-col bg-surface">
			<NavBar />
			<div className="min-h-0 flex-1 overflow-auto">
				<Outlet />
			</div>
		</div>
	);
}
```

```tsx
// components/NavBar.tsx — the ONLY definition of this chrome
import { Link, useLocation } from "react-router";

const items = [
	{ to: "/", label: "概览", icon: "icon-[lucide--layout-dashboard]" },
	{ to: "/products", label: "商品", icon: "icon-[lucide--package]" },
];

export function NavBar() {
	const { pathname } = useLocation();
	return (
		<nav className="flex items-center gap-1 border-b border-border px-4 py-2">
			{items.map((item) => (
				<Link
					key={item.to}
					to={item.to}
					className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
						pathname === item.to ? "bg-primary/10 text-primary" : "text-muted"
					}`}
				>
					<span className={`${item.icon} size-4`} />
					{item.label}
				</Link>
			))}
		</nav>
	);
}
```

```tsx
// frames/products.tsx — a screen is composition, nothing structural
export const frame = { width: 1440, height: 900, title: "商品" };

import { StatCard } from "../components/StatCard";

export default function Products() {
	return (
		<div className="flex h-full flex-col gap-6 p-8">
			<h1 className="text-xl font-semibold text-surface-foreground">商品</h1>
			<div className="grid grid-cols-4 gap-4">
				<StatCard label="在售" value="1,284" />
			</div>
		</div>
	);
}
```

## The checks

Go through your actual files and answer each one. Any "no" is a defect to fix
now, not a note to report.

1. **Chrome defined once?** Grep your sources for the nav bar's markup. It must
   appear in exactly one file. If two frames both contain the sidebar's markup,
   extract it.
2. **Real router?** `grep -n "react-router" frames/*.tsx components/*.tsx` must
   hit. If instead you find `const Link = ...` or `const useLocation = ...`
   defined locally, you faked the router — import it.
3. **No internal `<a href>`?** Cross-screen navigation is `<Link to>`. A bare
   anchor triggers a full reload and remounts the shell.
4. **Shell survives navigation?** If the chrome is meant to persist, it belongs
   in `frames/_layout.tsx`. If every frame wraps itself in an `AppShell`
   component instead, that is acceptable — but only when combined with `<Link>`
   navigation, otherwise nothing persists at all.
5. **Icons are Iconify classes?** `grep -c "icon-\["` must be > 0, and there
   must be no hand-written `function Icon(...)`, no inline `<svg><path d="…">`
   soup, and no emoji/character stand-ins.
6. **Props actually match?** Any component you wrote and called — check the call
   sites pass the props the signature declares. Nothing typechecks these sources
   at runtime, so a renamed prop fails silently (e.g. an `Icon` taking `name`
   but always called with `icon` renders one fallback glyph everywhere).
7. **Colors from tokens?** No `#rrggbb` in `className`. Use `bg-primary`,
   `text-muted`, `border-border`; add new tokens to `theme.css` `@theme`.
8. **Readable formatting?** Nested markup one element per line. Everything on a
   single line destroys element→source mapping: every element then reports the
   same `frames/x.tsx:LINE`, and the user's "让 Vetta 调整" can no longer target
   anything.
9. **Every touched frame screenshotted?** `vetd_screenshot` per frame, and the
   PNG actually Read — not just captured.

`vetd_status` runs the mechanical half of this list for you and returns the
findings as `issues`. It cannot see 1, 4, 6 or 9 — those are yours to check.
