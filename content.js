(function () {
  "use strict";

  // Prevent multiple injections
  if (window.__contextLexLoaded) return;
  window.__contextLexLoaded = true;

  // Pure logic lives in core.js, which the manifest loads first.
  const core = globalThis.ContextLexCore;
  if (!core) return;

  // Definitions already fetched on this page, so a word is requested once.
  const cache = core.createCache();

  let tooltip = null;
  let currentText = null;
  let activeLookup = null; // AbortController of the lookup in flight
  let isMouseDown = false;
  let mouseTimer = null; // pending selection check after a mouse event
  let selectionTimer = null; // pending selection check after selectionchange

  // Create tooltip element
  function createTooltip() {
    // Start again if the page removed our element
    if (tooltip && tooltip.isConnected) return tooltip;

    tooltip = document.createElement("div");
    tooltip.id = "contextlex-tooltip";
    // A polite live region: a screen reader reads the definition when it
    // arrives, without focus moving. The definitions are in English
    // whatever the language of the page.
    tooltip.setAttribute("role", "status");
    tooltip.setAttribute("aria-live", "polite");
    tooltip.setAttribute("aria-atomic", "true");
    tooltip.setAttribute("lang", "en");
    document.body.appendChild(tooltip);
    return tooltip;
  }

  // Stop the lookup in flight, if any
  function cancelLookup() {
    if (activeLookup) {
      activeLookup.abort();
      activeLookup = null;
    }
  }

  // Remove tooltip
  function hideTooltip() {
    cancelLookup();
    if (tooltip) {
      tooltip.remove();
      tooltip = null;

      // Selection checks still waiting belong to what was just dismissed
      clearTimeout(mouseTimer);
      clearTimeout(selectionTimer);
    }
    currentText = null;
  }

  // Position tooltip near the selected range
  function positionTooltip(range) {
    if (!tooltip) return;

    const rect = range.getBoundingClientRect();

    const position = core.computePosition({
      rect,
      tooltip: { width: tooltip.offsetWidth, height: tooltip.offsetHeight },
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      scroll: { x: window.scrollX, y: window.scrollY },
    });

    tooltip.style.top = `${position.top}px`;
    tooltip.style.left = `${position.left}px`;
  }

  // The focused element, looking through open shadow roots
  function deepActiveElement() {
    let active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active;
  }

  // The node an event started on, even inside an open shadow root. This
  // has to be read while the event is being dispatched.
  function eventOrigin(event) {
    const path =
      typeof event.composedPath === "function" ? event.composedPath() : [];
    return path[0] || event.target;
  }

  // True when the selection belongs to something the user is typing in
  function isEditableContext(selection, origin) {
    return [
      origin,
      deepActiveElement(),
      selection.anchorNode,
      selection.focusNode,
    ].some(core.isEditableNode);
  }

  // Build an element whose text is set with textContent, so nothing that
  // comes back from the API is ever parsed as HTML.
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function showMessage(className, text) {
    if (!tooltip) return;
    tooltip.replaceChildren(element("div", className, text));
  }

  // Render a definition
  function renderDefinition(data) {
    if (!tooltip) return;

    const heading = element("div", "contextlex-word", data.word);
    if (data.phonetic) {
      heading.append(" ", element("span", "contextlex-phonetic", data.phonetic));
    }
    if (data.isPhrase) {
      heading.append(" ", element("span", "contextlex-phrase-tag", "phrase"));
    }

    const meanings = element("div", "contextlex-meanings");
    for (const meaning of data.meanings) {
      const item = element("div", "contextlex-meaning");
      if (meaning.partOfSpeech) {
        item.append(element("span", "contextlex-pos", meaning.partOfSpeech));
      }
      item.append(element("span", "contextlex-def", meaning.definition));
      if (meaning.example) {
        item.append(
          element("span", "contextlex-example", `"${meaning.example}"`),
        );
      }
      meanings.append(item);
    }

    tooltip.replaceChildren(heading, meanings);
  }

  // Show loading state
  function showLoading(range) {
    createTooltip();
    tooltip.setAttribute("aria-busy", "true");
    showMessage("contextlex-loading", "Loading...");
    tooltip.style.opacity = "1";
    tooltip.style.visibility = "visible";
    positionTooltip(range);
  }

  // Main handler for text selection
  async function handleSelection(origin) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    // Never look up what the user is typing: inputs (password fields
    // included), textareas and contenteditable content
    if (isEditableContext(selection, origin)) return;

    // Text selected inside the tooltip is for copying, not for a lookup
    if (tooltip && tooltip.contains(selection.anchorNode)) return;

    const text = core.cleanSelection(selection.toString());

    // Ignore if same text or invalid
    if (!text || text === currentText || !core.isValidText(text)) {
      return;
    }

    // A new lookup replaces the one in flight
    cancelLookup();
    const controller = new AbortController();
    activeLookup = controller;
    currentText = text;

    // Keep our own copy: the live selection can change while we wait
    const range = selection.getRangeAt(0).cloneRange();
    showLoading(range);

    const result = await core.lookup(text, {
      fetchImpl: (url, init) => fetch(url, init),
      signal: controller.signal,
      cache,
      isOnline: () => navigator.onLine !== false,
    });

    // Replaced by a newer lookup or dismissed while waiting
    if (activeLookup !== controller) return;
    activeLookup = null;

    if (result.status === "ok") {
      renderDefinition(result.data);
    } else {
      showMessage("contextlex-error", core.describeFailure(result, text));
    }
    if (tooltip) tooltip.setAttribute("aria-busy", "false");
    positionTooltip(range);
  }

  // Track mouse state for selection detection
  document.addEventListener("mousedown", () => {
    isMouseDown = true;
  });

  // Handle text selection on mouseup (for click-and-drag selections)
  document.addEventListener("mouseup", (e) => {
    isMouseDown = false;

    // Ignore clicks on tooltip itself
    if (tooltip && tooltip.contains(e.target)) return;

    // Small delay to let selection complete
    const origin = eventOrigin(e);
    clearTimeout(mouseTimer);
    mouseTimer = setTimeout(() => {
      handleSelection(origin);
    }, 50);
  });

  // Keep double-click for single word selection
  document.addEventListener("dblclick", (e) => {
    // Ignore clicks on tooltip itself
    if (tooltip && tooltip.contains(e.target)) return;

    // Small delay to let selection complete
    const origin = eventOrigin(e);
    clearTimeout(mouseTimer);
    mouseTimer = setTimeout(() => {
      handleSelection(origin);
    }, 10);
  });

  // Touch device support - detect selection changes
  document.addEventListener("selectionchange", () => {
    clearTimeout(selectionTimer);

    selectionTimer = setTimeout(() => {
      // Don't trigger during mouse drag
      if (isMouseDown) return;

      handleSelection(null);
    }, 400);
  });

  // Dismiss tooltip on click outside
  document.addEventListener("click", (e) => {
    // Don't dismiss if clicking to make a selection
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) return;

    if (tooltip && !tooltip.contains(e.target)) {
      hideTooltip();
    }
  });

  // Dismiss on scroll
  document.addEventListener("scroll", hideTooltip, { passive: true });

  // Dismiss on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideTooltip();
    }
  });

  // Clean up on page unload
  window.addEventListener("beforeunload", hideTooltip);
})();
