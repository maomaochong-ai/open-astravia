# Structure self-check

Run this against your own output **before reporting back**, whenever the design
is a UI product (app screens / dashboard / website) with more than one screen,
or with chrome that repeats across screens — a nav bar, sidebar, tab bar or page
header.

Skip it entirely for posters, slides, infographics and single-screen designs.

This list is deliberately short. Everything mechanical — a faked router, an
`<a href>` between screens, a hand-written icon component, hex colors in
`className`, minified formatting, a missing frame size — is already checked for
you and comes back as `issues` on `vetd_screenshot` and `vetd_status`. What
follows is the part no checker can see. The reference shape to compare against
is the template block in `SKILL.md`.

## The checks

Go through your actual files and answer each one. Any "no" is a defect to fix
now, not a note to report. Fix it with a targeted `edit`.

1. **Chrome defined once?** Grep your sources for the nav bar's markup. It must
   appear in exactly one file. If two frames both contain the sidebar's markup,
   extract it into `components/`.
2. **Shell survives navigation?** If the chrome is meant to persist across
   screens, it belongs in `frames/_layout.tsx`. If every frame wraps itself in
   an `AppShell` component instead, that is acceptable — but only combined with
   `<Link>` navigation, otherwise nothing persists at all.
3. **Props actually match?** For any component you wrote and called, check the
   call sites pass the props the signature declares. Nothing typechecks these
   sources at runtime, so a renamed prop fails silently — e.g. an icon slot
   taking `name` but always called with `icon` renders one fallback glyph
   everywhere, and the source reads fine.
4. **Every touched frame screenshotted?** `vetd_screenshot` per frame, and the
   PNG actually Read — not just captured.
