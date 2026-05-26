/**
 * Einheitliche Tastatur-Hinweise: kompakt (Kbd-Badge) vs. ausführlich (Suffix / Leiste).
 */

export function isCompactKeyHints() {
  return window.matchMedia("(max-width: 767px)").matches;
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Suffix-Stil wie Intro: „Label (H)“ */
export function keyHintSuffixHtml(key) {
  if (!key) return "";
  const label = String(key).replace(/^\(|\)$/g, "");
  return ` <span class="key-hint key-hint-suffix" aria-hidden="true">(${escapeHtml(label)})</span>`;
}

/** Kompakt: Badge vor dem Label */
export function keyHintPrefixHtml(key) {
  if (!key) return "";
  const label = String(key).replace(/^\(|\)$/g, "");
  return `<kbd class="key-hint key-hint-prefix" aria-hidden="true">${escapeHtml(label)}</kbd> `;
}

export function labelWithKeyHint(label, key, { forcePrefix = false } = {}) {
  if (!key) return escapeHtml(label);
  if (forcePrefix || isCompactKeyHints()) {
    return `${keyHintPrefixHtml(key)}${escapeHtml(label)}`;
  }
  return `${escapeHtml(label)}${keyHintSuffixHtml(key)}`;
}

/** Button-Label inkl. Hint; speichert key in dataset. */
export function setButtonKeyHint(btn, label, key, options = {}) {
  if (!btn) return;
  btn.dataset.uiLabel = label;
  if (key) btn.dataset.keyHint = key;
  else delete btn.dataset.keyHint;
  btn.innerHTML = labelWithKeyHint(label, key, options);
}

/** <summary>-Zusatz für details (F / P). */
export function detailsHintHtml(key, isOpen = false) {
  if (!key) return "";
  const k = escapeHtml(String(key).replace(/^\(|\)$/g, ""));
  if (isCompactKeyHints()) {
    return ` <kbd class="key-hint details-hint-kbd" aria-hidden="true">${k}</kbd>`;
  }
  if (isOpen) {
    return ` <span class="details-hint muted">· <kbd class="key-hint">${k}</kbd> schließen</span>`;
  }
  return ` <span class="details-hint muted">· Taste <kbd class="key-hint">${k}</kbd></span>`;
}

export function syncDetailsKeyHint(detailsEl) {
  if (!detailsEl) return;
  const key = detailsEl.dataset.keyHint;
  if (!key) return;
  const hint = detailsEl.querySelector(".details-hint-slot");
  if (hint) hint.outerHTML = `<span class="details-hint-slot">${detailsHintHtml(key, detailsEl.open)}</span>`;
}

export function bindDetailsKeyHintSync(root = document) {
  root.querySelectorAll("details[data-key-hint]").forEach((el) => {
    el.addEventListener("toggle", () => syncDetailsKeyHint(el));
    syncDetailsKeyHint(el);
  });
}

let resizeBound = false;

export function initKeyHintsLayout(onLayoutChange) {
  if (resizeBound) return;
  resizeBound = true;
  const mq = window.matchMedia("(max-width: 767px)");
  const refresh = () => onLayoutChange?.();
  mq.addEventListener("change", refresh);
  window.addEventListener("resize", refresh);
}
