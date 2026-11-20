# Changelog

Notable changes to ContextLex. Versions follow [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-11-20

No new user-facing features. This release fixes bugs, adds tests and corrects the documentation.

### Fixed

- Text selected in a text input, a textarea or a contenteditable editor was sent to the dictionary API. Selections there are now ignored.
- A second lookup did not cancel the first, so two requests could be running at once. A new lookup, or closing the tooltip, now aborts the request in flight.
- A request that hung left the tooltip on "Loading..." until the browser gave up on it. A lookup now gives up after 8 seconds.
- Every failure read "Definition not found". No definition, being offline, a timeout and a failed request now each have their own message.
- The tooltip was misplaced on horizontally scrolled pages and could land above the visible area when it flipped above the selection.
- Near the right edge of the window, or on a page scrolled sideways, the tooltip could shrink to a narrow, tall column touching the window edge, because its width depended on its own position. It is now sized to its content, up to 320px, and keeps its 8px margin.
- On pages in quirks mode (no doctype) the tooltip never moved above a word near the bottom of the window and ended up below the visible area.
- The phonetic spelling was missing when the response had no top-level `phonetic` and its first `phonetics` item had no text (the response for "hello" is one example).
- Words with a curly apostrophe (don’t), a soft hyphen or a zero-width character were ignored.
- Selecting only a hyphen or an apostrophe started a lookup.
- Pressing Escape or scrolling within 400 ms of a double-click closed the tooltip, which then opened again.
- A word selected inside the tooltip started a new lookup after 400 ms.
- If the page removed the tooltip element, no tooltip appeared again until reload, and selecting the same word again did nothing.
- A selection in a document without a `<body>` (an SVG file opened in a tab, for example) threw an error.
- `text-transform: italic` in the stylesheet was not valid CSS and has been removed.
- The margins and padding inside the tooltip were never applied: the `#contextlex-tooltip *` reset was more specific than the class rules that set them. Those rules now start with `#contextlex-tooltip`.

### Changed

- The tooltip is built with DOM nodes and `textContent`. API text was escaped by hand and assigned through `innerHTML` before.
- The same word is requested once per page: answers are kept in a 100-entry in-memory cache.
- Requests are sent with `credentials: "omit"`, `referrerPolicy: "no-referrer"` and `cache: "no-store"`.
- The tooltip is a polite live region (`role="status"`) marked `lang="en"`. It had `role="tooltip"` with nothing referring to it.
- Under `prefers-reduced-motion: reduce`, transitions and animations a page's CSS might apply to the tooltip are blocked.
- The tooltip's maximum width respects narrow viewports.
- Example sentences and the "phrase" label have a text contrast of at least 4.5:1 against their background, in both themes. The colours moved by a few shades: in the light theme the example text was at 4.48:1 and the label at 3.66:1.
- Logic that needs no DOM moved from `content.js` to `core.js`, which the manifest loads first.
- Manifest description rewritten; version is 1.1.0.
- README corrected: it said the extension needs no permissions without mentioning that the content script runs on all sites, said phrases are ignored when the first three words of a selection are looked up, and did not say that every qualifying selection (not only a double-click) is sent to the API.

### Added

- Icons at 16, 48 and 128 pixels, drawn by `scripts/generate-icons.js`.
- Tests run with `node --test` (no dependencies) for `core.js`, for loading `core.js` and `content.js` together, and for the manifest, the icons and the stylesheet.
- `npm run check`, a syntax check for every `.js` and `.json` file.
- A GitHub Actions workflow that runs the check and the tests on pushes to `main` and on pull requests.
- This changelog.

## [1.0.0]

The first version, as committed on 2026-01-14: double-click or select text to see definitions from the Free Dictionary API in a tooltip, with light and dark styles.
