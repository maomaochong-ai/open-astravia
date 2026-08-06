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

## Screenshot checklist

Run this against every screenshot you Read. These are rendering defects, not
taste: the source looks correct in all of them, which is exactly why the only
way to catch them is to look at the image.

**1. Misalignment** — the most common one, and the easiest to miss in code.

- Items in a row/column that should share an edge but do not: labels and values
  in a list, card titles, form labels, icon+text pairs whose baselines differ.
- Cards in the same row with different heights, or a grid whose last row breaks
  the rhythm. Usually a missing `items-stretch`/`items-center` or a per-card
  padding that drifted.
- Content that ignores the page's left edge — a section inset by `p-6` next to
  one inset by `p-8`. Pick one gutter for the frame and hold it everywhere.
- A sidebar/nav that does not line up with the content it labels.

**2. Unintended text wrapping** — the shot shows two lines where one was meant.

- Buttons, tabs, table headers, badges, nav items and stat labels wrapping to a
  second line, or a single word dropping alone onto the next line.
- CJK copy is wider than the English you sized the container for; the layout
  that fits "Save" does not fit "保存草稿".
- Fixes, in order: shorten the copy, widen the container, or `whitespace-nowrap`
  plus `truncate` where clipping is acceptable. Shrinking the font is the wrong
  fix — it breaks the type scale to hide a layout problem.
- The opposite defect counts too: text that should wrap but instead overflows
  its container or gets clipped mid-character.

**3. Blank icons** — an icon slot renders as empty space or a solid block.

- The icon name does not exist in the set, or the set is not one of the offline
  ones (`lucide`, `tabler`, `mdi`, `simple-icons`). Then the class matches no
  generated CSS at all: the span has no glyph and no width, so the slot
  silently collapses. The source looks perfectly fine.
- The glyph renders but is invisible: icons are a mask tinted with
  `currentColor`, so one sitting on an accent block without a foreground token
  is the same color as its background.
- Wrong size: without a `size-*`/`w-*`+`h-*` class an icon is `1em`, i.e. it
  follows the inherited font size — the same icon then comes out at different
  sizes in a heading and in a caption.
- Check every icon in the shot, not just the ones you added last.

**4. The rest**

- Clipping and truncation: anything cut off by an edge or an `overflow-hidden`.
- Contrast: light gray on white is the second most common failure.
- Height: the frame fills its declared height — no dead space at the bottom, no
  content running past it.
- Anything that renders as a raw placeholder: a broken image box, an empty list
  where content was expected, an unstyled control.

Fix what you find and screenshot again. A frame is done when the image is
clean, not when the code reads correctly.

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

The canvas keeps showing its last good rendering with a "build failed" badge —
so a broken frame looks *fine* on the canvas, which is exactly why you cannot
judge it from there.

Every `vetd_screenshot` parses the sources first. A frame whose own file (or
`_layout.tsx`, or anything in `components/`) does not parse returns the syntax
error with its line instead of an image; `vetd_status` reports the same thing
under `issues`. Go to that line and fix the broken region with an `edit` — a
full rewrite costs many times more and usually breaks something else. Never
declare a frame done while it still reports one.

`vetd_status` also returns the engine's recent build output, which is where to
look when a frame renders blank for no obvious reason.
