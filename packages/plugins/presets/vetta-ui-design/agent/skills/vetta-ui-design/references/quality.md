# Quality bar

Read before declaring a frame done. Applies to every product type; the product
preset in SKILL.md adds emphasis, it does not replace this.

- **Spacing** on one consistent scale (Tailwind's 4px steps). No `mt-[13px]`.
- **Type**: at most 4 sizes per frame, with a visible weight/size gap between
  levels. If two levels look similar, merge them.
- **Color**: theme tokens only, one accent used sparingly. Check text/background
  contrast — light gray on white is the second most common failure.
- **Corners, borders, shadows** consistent across the whole document.
- **Real content**: plausible names, prices, dates, copy — never Lorem ipsum or
  `Item 1 / Item 2`. Write copy in the language the user is using.
- **States**: for interactive UI cover hover/disabled, and design the empty and
  loading cases when the screen can have them. Where a state is reachable by
  clicking, make it real rather than drawing a second frame for it.
- **Icons must match meaning** — never reach for a random glyph to fill space.

## Why remote image URLs are banned

Hard rule 7 is not a style preference. Screenshots (canvas thumbnails, "让
Vetta 调整", 导出渲染图) must re-`fetch` every image and inline it as a data
URL — a browser cannot export a canvas tainted by a cross-origin image. So a
remote URL that renders perfectly on screen will still:

- **fail** the shot whenever `fetch` cannot get it (CDN without CORS headers,
  404, offline) — that image comes out blank, and the failure is cached for the
  rest of the frame's life;
- **slow it down** by a full network round trip per image; a frame with dozens
  of remote images turns a ~100ms shot into seconds.

Local assets are served same-origin by the engine dev server and have neither
problem.

## When a frame fails to build

The canvas keeps showing its last good rendering with a "build failed" badge,
and `vetd_screenshot` returns the compile error instead of an image
(`vetd_status` reports it as `buildError` on the frame). Fix the source and
screenshot again — never declare a frame done while it still reports a build
error.

`vetd_status` also returns the engine's recent build output, which is where to
look when a frame renders blank for no obvious reason.
