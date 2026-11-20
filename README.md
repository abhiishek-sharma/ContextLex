# ContextLex

A Chrome extension (Manifest V3) that shows the dictionary definition of a word in a tooltip when you double-click it on a web page.

It has no settings, no background script, no runtime dependencies and no build step. Definitions come from the [Free Dictionary API](https://dictionaryapi.dev/).

## What it does

- **Double-click a word** to see its definition in a tooltip next to it: the word, its phonetic spelling when the API has one, and up to three meanings (the first definition of each of the first three parts of speech), each with an example sentence when the API has one.
- **Select a few words** and the first three are looked up one by one and listed together. This is not a phrase lookup: "ice cream" shows the meaning of "ice" and the meaning of "cream".
- The tooltip opens below the selection, moves above it when there is no room below, and is kept inside the visible area with an 8px margin where it fits.
- It closes when you click elsewhere, scroll the page or press Escape. Looking up another word replaces it.
- Light and dark styles follow the system theme (`prefers-color-scheme`).
- A word that has been answered is not requested again on the same page. Answers (definitions and "not found") are kept in memory, up to 100 words, until the page is reloaded or closed.
- A lookup is given 8 seconds. Starting a new lookup or closing the tooltip cancels the request that is still running.
- "No definition found", being offline, a timeout and a failed request each show their own message.
- Text you select inside an input, a textarea or a contenteditable editor is not looked up.

## Installation

### From source

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** using the toggle in the top-right corner
4. Click **Load unpacked**
5. Select the `ContextLex` folder

Nothing needs to be installed or built first.

### Updating

1. Pull the latest changes or re-download the repository
2. Go to `chrome://extensions/`
3. Click the refresh icon on the ContextLex card
4. Refresh any open tabs to reload the content script

## Usage

1. Navigate to any webpage
2. Double-click a word you want to define
3. Read the definition in the tooltip that appears
4. Click anywhere else, scroll, or press Escape to dismiss

A lookup starts for any selection that is made only of words: letters (A to Z and Latin-1 accented letters such as é), hyphens, apostrophes and spaces, up to 100 characters. It does not matter whether you selected by double-clicking, by dragging, or with the keyboard or touch (those two start the lookup after a 400 ms pause). A selection that contains anything else (digits, punctuation, other alphabets) is ignored.

## Privacy

ContextLex sends the words you select to a third-party service, so here is exactly what leaves your browser.

- **What is sent:** the selected word, lower-cased, as part of the address of a `GET` request to `https://api.dictionaryapi.dev/api/v2/entries/en/<word>`. For a selection of several words there is one request per word, for the first three words only.
- **When:** every time a selection starts a lookup (see [Usage](#usage)), not only on double-click. Selecting a name to copy it, for example, sends that name. Words answered from the in-page cache are not sent again.
- **What is not sent by the extension:** the page address, the surrounding text, cookies or any identifier. Requests are made with `credentials: "omit"` and `referrerPolicy: "no-referrer"`.
- **What the browser adds anyway:** the request is made from the page you are on, so like any request from a web page it carries your IP address and the browser's standard headers. One of them is `Origin`, which names the site you are reading (its domain, not the page address).
- **What is stored:** nothing that outlives the page. The extension's cache lives in the memory of the page and disappears with it, and requests are made with `cache: "no-store"`, so the browser's HTTP cache does not keep the answers either. The extension uses no storage API, has no background script and contains no analytics.

ContextLex has no control over what dictionaryapi.dev logs.

## Permissions

`manifest.json` requests no API permissions (`"permissions": []`) and no `host_permissions`.

It does declare its content script for `<all_urls>`. That is how the extension sees the text you select and draws the tooltip, and it means Chrome treats the extension as having access to all sites (see **Site access** on the extension's details page).

## Where it works

The content script runs in the top frame of ordinary web pages. It does not run on:

- Chrome internal pages (`chrome://`)
- The Chrome Web Store
- PDF documents opened in the browser
- Local files, unless **Allow access to file URLs** is enabled in the extension's details
- Content inside iframes (the manifest does not set `all_frames`)

## Accessibility

- The tooltip is a polite live region (`role="status"`, `aria-live="polite"`, `aria-atomic="true"`) with `aria-busy` set while loading, so a screen reader can read the definition when it arrives without focus moving. It is marked `lang="en"`.
- Escape closes it.
- It has no animation. Under `prefers-reduced-motion: reduce` the stylesheet also blocks transitions and animations that a page's own CSS might apply to it.

This has not been tested with a screen reader yet.

## Limitations

- English only: the extension uses the English endpoint of the API.
- It needs a network connection, except for words already looked up on the same page.
- Several selected words are looked up word by word, not as a phrase, and only the first three.
- A drag selection that includes punctuation or digits (for example `word,`) is ignored.
- The check for form fields looks through open shadow roots only. A field inside a closed shadow root is not recognised.
- Only scrolling the page closes the tooltip. Scrolling inside a nested scrollable area does not, and the tooltip does not follow the text if the layout changes (for example when the window is resized).
- The tooltip is an element in the page, styled by a normal stylesheet, so a site's own CSS can change how it looks.
- The Free Dictionary API is a free service with rate limits. When it refuses or fails a request, the tooltip shows an error message with the HTTP status.
- Not checked on sites with a strict Content Security Policy. If a page blocks the request, the tooltip shows the "Could not reach the dictionary" message.

## Development

The extension itself needs no tooling. Node.js 22 or newer is only needed to run the tests and scripts, and there is nothing to `npm install`.

| Command | What it does |
| --- | --- |
| `npm test` | Runs the tests with `node --test` |
| `npm run check` | Runs `node --check` on every `.js` file and parses every `.json` file |
| `npm run icons` | Redraws the PNG icons in `icons/` |

GitHub Actions (`.github/workflows/ci.yml`) runs `npm run check` and `npm test` on every push and pull request, on Node 22, 24 and 26.

### How the code is split

- `core.js` holds the logic that needs no DOM: cleaning and validating the selected text, parsing the API response, the lookup itself (cache, timeout, cancellation, failure messages) and the positioning maths. Chrome loads it as the first content script. The tests load the same file with `require()`.
- `content.js` connects that logic to the page: selection events, building the tooltip with DOM nodes (`textContent`, never HTML strings) and dismissing it.

### What the tests cover

`test/core.test.js` covers `core.js`, using a stand-in for `fetch`. `test/extension.test.js` checks `manifest.json`, the icon files, that the changelog has an entry for the manifest version, and that no content script writes HTML strings into the page.

`content.js` has no automated tests. It needs a real DOM, and the project has no browser test set-up.

### File structure

```
ContextLex/
├── manifest.json              # Extension manifest (Manifest V3)
├── core.js                    # Logic with no DOM access (tested)
├── content.js                 # Content script: events and tooltip rendering
├── styles.css                 # Tooltip styles, light and dark
├── icons/                     # icon16.png, icon48.png, icon128.png
├── scripts/
│   ├── check.js               # Syntax check behind `npm run check`
│   └── generate-icons.js      # Draws the icons
├── test/
│   ├── core.test.js           # Tests for core.js
│   └── extension.test.js      # Checks on the manifest, icons and scripts
├── .github/workflows/ci.yml   # CI: syntax check and tests
├── package.json               # Script shortcuts only, no dependencies
├── CHANGELOG.md
├── LICENSE
└── README.md
```

## License

MIT. See [LICENSE](LICENSE).
