(function () {
  "use strict";

  // Prevent multiple injections
  if (window.__contextLexLoaded) return;
  window.__contextLexLoaded = true;

  // Pure logic lives in core.js, which the manifest loads first.
  const core = globalThis.ContextLexCore;
  if (!core) return;

  let tooltip = null;
  let currentText = null;
  let isMouseDown = false;

  // Create tooltip element
  function createTooltip() {
    if (tooltip) return tooltip;

    tooltip = document.createElement("div");
    tooltip.id = "contextlex-tooltip";
    tooltip.setAttribute("role", "tooltip");
    document.body.appendChild(tooltip);
    return tooltip;
  }

  // Remove tooltip
  function hideTooltip() {
    if (tooltip && tooltip.parentNode) {
      tooltip.remove();
      tooltip = null;
    }
    currentText = null;
  }

  // Position tooltip near selection
  function positionTooltip(selection) {
    if (!tooltip || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
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

  // Fetch word definition from Free Dictionary API
  async function fetchDefinition(word) {
    try {
      const response = await fetch(core.buildApiUrl(word));

      if (!response.ok) {
        return null;
      }

      return core.parseEntry(await response.json(), word);
    } catch (error) {
      console.error("ContextLex: Failed to fetch definition", error);
      return null;
    }
  }

  // A multi-word selection is not looked up as a phrase: the first few
  // words are looked up one by one and shown together.
  async function fetchPhraseInfo(phrase, words) {
    const entries = [];
    for (const word of words.slice(0, core.MAX_PHRASE_WORDS)) {
      const entry = await fetchDefinition(word);
      if (entry) {
        entries.push(entry);
      }
    }

    if (entries.length === 0) {
      return null;
    }

    return core.combinePhrase(phrase, entries);
  }

  // Render tooltip content
  function renderTooltip(data) {
    if (!tooltip) return;

    if (!data) {
      tooltip.innerHTML = `<div class="contextlex-error">Definition not found</div>`;
      return;
    }

    let html = `<div class="contextlex-word">${escapeHtml(data.word)}`;
    if (data.phonetic) {
      html += ` <span class="contextlex-phonetic">${escapeHtml(data.phonetic)}</span>`;
    }
    if (data.isPhrase) {
      html += ` <span class="contextlex-phrase-tag">phrase</span>`;
    }
    html += `</div>`;

    html += `<div class="contextlex-meanings">`;
    for (const meaning of data.meanings) {
      html += `<div class="contextlex-meaning">`;
      html += `<span class="contextlex-pos">${escapeHtml(meaning.partOfSpeech)}</span>`;
      html += `<span class="contextlex-def">${escapeHtml(meaning.definition)}</span>`;
      if (meaning.example) {
        html += `<span class="contextlex-example">"${escapeHtml(meaning.example)}"</span>`;
      }
      html += `</div>`;
    }
    html += `</div>`;

    tooltip.innerHTML = html;
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // Show loading state
  function showLoading(selection) {
    createTooltip();
    tooltip.innerHTML = `<div class="contextlex-loading">Loading...</div>`;
    tooltip.style.opacity = "1";
    tooltip.style.visibility = "visible";
    positionTooltip(selection);
  }

  // Main handler for text selection
  async function handleSelection() {
    const selection = window.getSelection();
    const text = selection ? core.cleanSelection(selection.toString()) : "";

    // Ignore if same text or invalid
    if (!text || text === currentText || !core.isValidText(text)) {
      return;
    }

    currentText = text;
    showLoading(selection);

    const words = core.splitWords(text);
    let definition = null;

    if (words.length === 1) {
      // Single word - fetch from dictionary API
      definition = await fetchDefinition(words[0]);
    } else {
      // Several words - show the first meaning of each
      definition = await fetchPhraseInfo(text, words);
    }

    // Check if text changed during fetch
    if (text !== currentText) return;

    renderTooltip(definition);
    positionTooltip(selection);
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
    setTimeout(() => {
      handleSelection();
    }, 50);
  });

  // Keep double-click for single word selection
  document.addEventListener("dblclick", (e) => {
    // Ignore clicks on tooltip itself
    if (tooltip && tooltip.contains(e.target)) return;

    // Small delay to let selection complete
    setTimeout(handleSelection, 10);
  });

  // Touch device support - detect selection changes
  let selectionTimeout = null;
  document.addEventListener("selectionchange", () => {
    // Only process on touch devices or when there's an active selection
    if (selectionTimeout) clearTimeout(selectionTimeout);

    selectionTimeout = setTimeout(() => {
      // Don't trigger during mouse drag
      if (isMouseDown) return;

      handleSelection();
    }, 400);
  });

  // Dismiss tooltip on click outside
  document.addEventListener("click", (e) => {
    // Don't dismiss if clicking to make a selection
    if (window.getSelection().toString().trim()) return;

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
