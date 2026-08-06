# GitHub — Vetta Edition

## Atmosphere
A developer's night desk. Dimmed navy-black panels, quiet borders, green for
"go" and blue for "link". Functional, information-first, zero glamour.

## Color roles
All colors come from `theme.css` tokens — never hardcode hex in frames.
- `surface` (#0d1117) page; `surface-raised` (#161b22) for headers, cards,
  code blocks.
- `primary` green means action/success: the merge/submit button, open state.
- `accent` blue for links, mentions, counters, focus.
- `danger` red for conflicts/deletions/diff minus; text `surface-foreground`,
  secondary `muted`; every box is closed by a 1px `border`.

## Typography
System font stack only:
- Headings small and matter-of-fact: `font-semibold` 16–24px.
- Body 14px; metadata 12px `muted`.
- `font-mono` is half the interface: code, diffs, hashes, branch names, in
  bordered `surface-raised` chips.

## Shape & depth
- Uniform `rounded-md` (6px) on nearly everything.
- Flat by default — borders carry the structure; `shadow-md`/`shadow-lg` only
  for menus and dialogs.

## Components
- Buttons: h-8, `rounded-md`, bordered; primary is filled green, everything
  else is `surface-raised` with border.
- Labels: colorful bordered pills at 12px (use `accent`/`primary`/`danger`
  at ~15% background opacity with matching text).
- Comment/issue boxes: bordered `surface-raised` header + `surface` body.
- Diff rows in `font-mono` 12px: added lines tinted `primary/15`, removed
  `danger/15`.

## Layout
Left-aligned utilitarian columns; container ~1216px, main+sidebar (~296px)
split. Spacing 8/16/24; boxes stack with 16px gaps. Dense but never cramped.

## Don'ts
- No pure black or pure white surfaces; stay in the dimmed palette.
- Green never decorates — only actions/success states.
- No borderless floating cards; if it groups content, it has a border.
