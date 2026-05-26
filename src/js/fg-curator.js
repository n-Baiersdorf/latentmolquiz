/**
 * Kurator: FG-Klassifikation je Molekül prüfen (Bild + Chips aus Katalog).
 */

import { loadAllInferenceSets, moleculeImagePath } from "./data-loader.js";
import {
  FG_ALKANE_ONLY_LABEL_DE,
  FG_CURATOR_CHIP_LABELS_DE,
  FG_UNKNOWN_LABEL_DE,
} from "./fg-labels-catalog.js";
import {
  loadFgOverrides,
  saveFgOverrides,
  poolSetKey as setKey,
} from "./fg-overrides.js";

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hasUnknownFg(mol) {
  const labels = mol?.fg_labels_de || [];
  return (
    !labels.length ||
    labels.includes(FG_UNKNOWN_LABEL_DE) ||
    mol.fg_primary_de === FG_UNKNOWN_LABEL_DE
  );
}

function reviewStatus(stored) {
  if (!stored?.status || stored.status === "pending") return "pending";
  return stored.status;
}

function listFgReviewItems(allSets) {
  const overrides = loadFgOverrides();
  const items = [];
  for (const setData of allSets) {
    const key = setKey(setData);
    setData.molecules.forEach((mol, molIdx) => {
      const stored = overrides[key]?.[String(molIdx)];
      items.push({
        key,
        setKey: key,
        itemId: `${key}:${molIdx}`,
        molIdx,
        setData,
        mol,
        stored: stored || null,
        needsReview: hasUnknownFg(mol) || stored?.status === "flagged",
      });
    });
  }
  return items;
}

function exportFgOverridesForBuild() {
  const overrides = loadFgOverrides();
  const lines = ["# FG-Kurator — in build.py als FG_MOLECULE_LABEL_OVERRIDES eintragen", ""];
  lines.push("FG_MOLECULE_LABEL_OVERRIDES: dict[str, dict[int, list[str]]] = {");
  const keys = Object.keys(overrides).sort();
  if (!keys.length) {
    lines.push("}");
    return lines.join("\n");
  }
  for (const setKey of keys) {
    const mols = overrides[setKey];
    const molKeys = Object.keys(mols).sort((a, b) => Number(a) - Number(b));
    if (!molKeys.length) continue;
    lines.push(`    "${setKey}": {`);
    for (const mi of molKeys) {
      const entry = mols[mi];
      if (!entry?.fg_labels_de?.length) continue;
      const labels = entry.fg_labels_de.map((l) => JSON.stringify(l)).join(", ");
      lines.push(`        ${mi}: [${labels}],`);
    }
    lines.push("    },");
  }
  lines.push("}");
  return lines.join("\n");
}

let allSets = [];
let reviewItems = [];
let reviewIdx = 0;
let filterMode = "all";
/** Leer = kein FG-Filter; sonst exakter Chip-Name aus dem FG-Katalog. */
let filterFgLabel = "";
let lastSavedKey = null;

/** Reihenfolge im FG-Dropdown (mit Zählung). */
const FG_FILTER_LABEL_OPTIONS = [
  FG_ALKANE_ONLY_LABEL_DE,
  FG_UNKNOWN_LABEL_DE,
  ...FG_CURATOR_CHIP_LABELS_DE.filter(
    (l) => l !== FG_ALKANE_ONLY_LABEL_DE && l !== FG_UNKNOWN_LABEL_DE
  ),
];

const STATUS_LABELS = {
  pending: "Offen",
  ok: "OK",
  edited: "Bearbeitet",
  flagged: "Markiert",
};

function moleculeFgLabels(item) {
  const stored = item.stored?.fg_labels_de;
  if (stored?.length) return stored;
  return item.mol.fg_labels_de || [];
}

function moleculeHasFgLabel(item, fgLabel) {
  if (!fgLabel) return true;
  if (fgLabel === FG_UNKNOWN_LABEL_DE) return hasUnknownFg(item.mol);
  if (fgLabel === FG_ALKANE_ONLY_LABEL_DE) {
    const labels = moleculeFgLabels(item);
    const primary = item.stored?.fg_primary_de ?? item.mol.fg_primary_de;
    return labels.includes(FG_ALKANE_ONLY_LABEL_DE) || primary === FG_ALKANE_ONLY_LABEL_DE;
  }
  const labels = moleculeFgLabels(item);
  const primary = item.stored?.fg_primary_de ?? item.mol.fg_primary_de;
  return labels.includes(fgLabel) || primary === fgLabel;
}

function countItemsWithFgLabel(items, fgLabel) {
  return items.filter((item) => moleculeHasFgLabel(item, fgLabel)).length;
}

function applyStatusFilter(items) {
  if (filterMode === "all") return items;
  if (filterMode === "edited") {
    return items.filter((item) => item.stored?.status === "edited");
  }
  if (filterMode === "unknown") {
    return items.filter((item) => hasUnknownFg(item.mol));
  }
  return items.filter(
    (item) =>
      hasUnknownFg(item.mol) ||
      item.stored?.status === "flagged" ||
      (item.stored?.status === "pending" && item.stored?.fg_labels_de)
  );
}

function applyFgLabelFilter(items) {
  if (!filterFgLabel) return items;
  return items.filter((item) => moleculeHasFgLabel(item, filterFgLabel));
}

function itemsForStatusFilter() {
  return applyStatusFilter(reviewItems);
}

function filteredItems() {
  return applyFgLabelFilter(itemsForStatusFilter());
}

function fgOptionLabel(fgLabel, count) {
  const base = fgLabel || "Alle FGs";
  return `${base} (${count})`;
}

function populateFgLabelFilterSelect() {
  const sel = document.getElementById("fg-filter-label");
  if (!sel) return;
  const prev = sel.value;
  const total = reviewItems.length;
  const options = [
    `<option value="">${escapeHtml(fgOptionLabel("", total))}</option>`,
    ...FG_FILTER_LABEL_OPTIONS.map((label) => {
      const n = countItemsWithFgLabel(reviewItems, label);
      return `<option value="${escapeHtml(label)}">${escapeHtml(fgOptionLabel(label, n))}</option>`;
    }),
  ];
  sel.innerHTML = options.join("");
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  else sel.value = filterFgLabel || "";
}

const STATUS_FILTER_LABELS = {
  all: "Alle Moleküle",
  needs_review: "Offen (Unbekannt / markiert)",
  unknown: "Nur Unbekannt (echt)",
  edited: "Nur bearbeitet",
};

function currentItem() {
  const items = filteredItems();
  if (!items.length) return null;
  return items[Math.min(reviewIdx, items.length - 1)];
}

function getEffectiveLabels(item) {
  const stored = item.stored;
  if (stored?.fg_labels_de?.length) return [...stored.fg_labels_de];
  const auto = item.mol.fg_labels_de || [];
  return auto.filter((l) => l !== FG_UNKNOWN_LABEL_DE);
}

function renderReviewNav() {
  const items = filteredItems();
  const label = document.getElementById("fg-review-progress");
  const list = document.getElementById("fg-review-list");
  if (label) {
    label.textContent = items.length
      ? `${reviewIdx + 1} / ${items.length}`
      : "Keine Treffer";
  }
  if (!list) return;

  list.innerHTML = items
    .map((item, i) => {
      const status = item.stored?.status || (hasUnknownFg(item.mol) ? "pending" : "ok");
      const active = i === reviewIdx ? " active" : "";
      const savedMark = item.itemId === lastSavedKey ? " fg-review-item-saved" : "";
      const unknownMark = hasUnknownFg(item.mol) ? " fg-review-item-unknown" : "";
      const fgPreview = getEffectiveLabels(item);
      const fgLine = fgPreview.length
        ? `<span class="fg-review-item-fgs muted">${escapeHtml(fgPreview.slice(0, 3).join(" · "))}${fgPreview.length > 3 ? " …" : ""}</span>`
        : "";
      return `<button type="button" class="fg-review-item${active}${savedMark}${unknownMark}" data-idx="${i}">
        <span class="fg-review-item-main">
          <span class="fg-review-item-id">${escapeHtml(item.setKey)} · #${item.molIdx + 1}</span>
          ${fgLine}
        </span>
        <span class="fg-review-item-status status-${status}">${escapeHtml(STATUS_LABELS[status] || status)}</span>
      </button>`;
    })
    .join("");

  list.querySelectorAll(".fg-review-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      reviewIdx = Number(btn.dataset.idx);
      renderReviewDetail();
      renderReviewNav();
    });
  });
}

function renderChipPicker(selectedSet, item) {
  const picker = document.getElementById("fg-chip-picker");
  if (!picker) return;
  picker.innerHTML = FG_CURATOR_CHIP_LABELS_DE.map((label) => {
    const on = selectedSet.has(label);
    return `<button type="button" class="fg-curator-chip${on ? " is-on" : ""}" data-fg="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
  }).join("");

  picker.querySelectorAll(".fg-curator-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fg = btn.dataset.fg;
      if (selectedSet.has(fg)) selectedSet.delete(fg);
      else selectedSet.add(fg);
      renderChipPicker(selectedSet, item);
      const primaryInput = document.getElementById("fg-primary-select");
      if (primaryInput && selectedSet.size) {
        if (![...selectedSet].includes(primaryInput.value)) {
          primaryInput.value = [...selectedSet][0];
        }
      }
    });
  });
}

function renderReviewDetail() {
  const detail = document.getElementById("fg-review-detail");
  const item = currentItem();
  if (!detail) return;

  if (!item) {
    detail.innerHTML = `<p class="muted">Keine Einträge für diesen Filter.</p>`;
    return;
  }

  item.itemId = `${item.setKey}:${item.molIdx}`;
  const selected = new Set(getEffectiveLabels(item));
  const autoLabels = item.mol.fg_labels_de || [];
  const isGt = item.molIdx === item.setData.ground_truth_ooo_idx;
  const imgSrc = moleculeImagePath(
    item.setData.strategy,
    item.setData.set_idx,
    item.molIdx
  );

  detail.innerHTML = `
    <div class="fg-review-detail-head">
      <h2>${escapeHtml(item.setKey)} · Molekül #${item.molIdx + 1}${isGt ? " · ★ Ausreißer" : ""}</h2>
      <p class="muted fg-review-smiles">${escapeHtml(item.mol.smiles || "")}</p>
      ${item.mol.mol_formula ? `<p class="muted">${escapeHtml(item.mol.mol_formula)}</p>` : ""}
    </div>
    <div class="fg-review-visual">
      <img class="fg-review-img" src="${escapeHtml(imgSrc)}" alt="Molekül #${item.molIdx + 1}">
    </div>
    <div class="fg-review-auto panel-single">
      <p class="fg-section-title">Automatisch (Build)</p>
      <p class="fg-review-auto-chips">${autoLabels.length ? autoLabels.map((l) => `<span class="fg-chip">${escapeHtml(l)}</span>`).join(" ") : "—"}</p>
    </div>
    <div class="fg-review-edit panel-single">
      <p class="fg-section-title">Kurator — Chips auswählen</p>
      <label class="fg-primary-label">Primär-Chip
        <select id="fg-primary-select" class="fg-primary-select"></select>
      </label>
      <div id="fg-chip-picker" class="fg-chip-picker"></div>
      <div class="fg-review-actions">
        <button type="button" id="fg-btn-save" class="action small">Speichern</button>
        <button type="button" id="fg-btn-ok" class="action secondary small">OK (auto passt)</button>
        <button type="button" id="fg-btn-flag" class="text-btn small">Markieren</button>
        <button type="button" id="fg-btn-clear" class="text-btn small">Override löschen</button>
      </div>
    </div>
  `;

  const primarySelect = document.getElementById("fg-primary-select");
  const refreshPrimaryOptions = () => {
    if (!primarySelect) return;
    const labels = [...selected];
    primarySelect.innerHTML = labels.length
      ? labels.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("")
      : `<option value="">—</option>`;
    if (labels.length && !labels.includes(primarySelect.value)) {
      primarySelect.value = labels[0];
    }
  };
  refreshPrimaryOptions();
  renderChipPicker(selected, item);

  document.getElementById("fg-btn-save")?.addEventListener("click", () => {
    if (!selected.size) {
      alert("Mindestens einen Chip auswählen.");
      return;
    }
    const overrides = loadFgOverrides();
    if (!overrides[item.setKey]) overrides[item.setKey] = {};
    overrides[item.setKey][String(item.molIdx)] = {
      status: "edited",
      fg_labels_de: [...selected],
      fg_primary_de: primarySelect?.value || [...selected][0],
      auto_fg_labels_de: autoLabels,
    };
    saveFgOverrides(overrides);
    item.stored = overrides[item.setKey][String(item.molIdx)];
    lastSavedKey = item.itemId;
    reloadReviewItems();
    populateFgLabelFilterSelect();
    updateSummary();
    renderReviewNav();
    renderReviewDetail();
  });

  document.getElementById("fg-btn-ok")?.addEventListener("click", () => {
    const overrides = loadFgOverrides();
    if (!overrides[item.setKey]) overrides[item.setKey] = {};
    overrides[item.setKey][String(item.molIdx)] = { status: "ok" };
    saveFgOverrides(overrides);
    item.stored = overrides[item.setKey][String(item.molIdx)];
    lastSavedKey = item.itemId;
    reloadReviewItems();
    populateFgLabelFilterSelect();
    updateSummary();
    reviewIdx = Math.min(reviewIdx, Math.max(0, filteredItems().length - 1));
    renderReviewNav();
    renderReviewDetail();
  });

  document.getElementById("fg-btn-flag")?.addEventListener("click", () => {
    const overrides = loadFgOverrides();
    if (!overrides[item.setKey]) overrides[item.setKey] = {};
    const prev = overrides[item.setKey][String(item.molIdx)] || {};
    overrides[item.setKey][String(item.molIdx)] = {
      ...prev,
      status: "flagged",
      fg_labels_de: prev.fg_labels_de || [...selected],
    };
    saveFgOverrides(overrides);
    reloadReviewItems();
    populateFgLabelFilterSelect();
    updateSummary();
    renderReviewNav();
    renderReviewDetail();
  });

  document.getElementById("fg-btn-clear")?.addEventListener("click", () => {
    const overrides = loadFgOverrides();
    if (overrides[item.setKey]) {
      delete overrides[item.setKey][String(item.molIdx)];
      if (!Object.keys(overrides[item.setKey]).length) delete overrides[item.setKey];
    }
    saveFgOverrides(overrides);
    item.stored = null;
    selected.clear();
    (item.mol.fg_labels_de || []).forEach((l) => {
      if (l !== FG_UNKNOWN_LABEL_DE) selected.add(l);
    });
    reloadReviewItems();
    populateFgLabelFilterSelect();
    updateSummary();
    renderReviewNav();
    renderReviewDetail();
  });
}

function reloadReviewItems() {
  const overrides = loadFgOverrides();
  reviewItems = listFgReviewItems(allSets).map((item) => ({
    ...item,
    stored: overrides[item.setKey]?.[String(item.molIdx)] || null,
  }));
}

function updateSummary() {
  const el = document.getElementById("fg-review-summary");
  if (!el) return;

  const inList = filteredItems().length;
  const statusPool = itemsForStatusFilter();
  const edited = Object.values(loadFgOverrides()).reduce(
    (n, mols) => n + Object.values(mols).filter((e) => e?.status === "edited").length,
    0
  );

  if (filterFgLabel) {
    const totalFg = countItemsWithFgLabel(reviewItems, filterFgLabel);
    const inStatus = countItemsWithFgLabel(statusPool, filterFgLabel);
    const statusName = STATUS_FILTER_LABELS[filterMode] || filterMode;
    el.textContent =
      `${filterFgLabel}: ${inList} in Liste · ${inStatus} bei „${statusName}“ · ${totalFg} gesamt im Pool`;
    return;
  }

  const unknown = countItemsWithFgLabel(reviewItems, FG_UNKNOWN_LABEL_DE);
  const alkaneOnly = countItemsWithFgLabel(reviewItems, FG_ALKANE_ONLY_LABEL_DE);
  const statusName = STATUS_FILTER_LABELS[filterMode] || filterMode;

  if (filterMode === "all") {
    el.textContent =
      `${reviewItems.length} Moleküle · ${unknown} Unbekannt · ${alkaneOnly} nur Alkan · ${edited} Overrides · ${inList} in Liste`;
    return;
  }

  el.textContent =
    `${statusName}: ${inList} in Liste · ${unknown} Unbekannt · ${alkaneOnly} nur Alkan · ${edited} Overrides (Pool ${reviewItems.length})`;
}

export async function showFgCuratorScreen() {
  if (!allSets.length) {
    allSets = await loadAllInferenceSets();
  }
  reloadReviewItems();
  reviewIdx = 0;
  filterMode = document.getElementById("fg-filter-mode")?.value || "all";
  filterFgLabel = document.getElementById("fg-filter-label")?.value || "";
  populateFgLabelFilterSelect();
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.id === "screen-fg-curator");
  });
  updateSummary();
  renderReviewNav();
  renderReviewDetail();
}

export function initFgCuratorBindings() {
  populateFgLabelFilterSelect();

  document.getElementById("fg-filter-mode")?.addEventListener("change", (e) => {
    filterMode = e.target.value;
    reviewIdx = 0;
    updateSummary();
    renderReviewNav();
    renderReviewDetail();
  });

  document.getElementById("fg-filter-label")?.addEventListener("change", (e) => {
    filterFgLabel = e.target.value;
    reviewIdx = 0;
    updateSummary();
    renderReviewNav();
    renderReviewDetail();
  });

  document.getElementById("fg-btn-export")?.addEventListener("click", () => {
    const text = exportFgOverridesForBuild();
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fg_overrides.py.txt";
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("fg-btn-reset-all")?.addEventListener("click", () => {
    if (!window.confirm("Alle FG-Overrides im Browser löschen?")) return;
    saveFgOverrides({});
    reloadReviewItems();
    updateSummary();
    renderReviewNav();
    renderReviewDetail();
  });

  document.getElementById("fg-btn-back-curator")?.addEventListener("click", () => {
    document.getElementById("screen-fg-curator")?.classList.remove("active");
    document.getElementById("screen-curator")?.classList.add("active");
  });

  document.getElementById("fg-btn-prev")?.addEventListener("click", () => {
    if (reviewIdx > 0) {
      reviewIdx--;
      renderReviewNav();
      renderReviewDetail();
    }
  });

  document.getElementById("fg-btn-next")?.addEventListener("click", () => {
    const items = filteredItems();
    if (reviewIdx < items.length - 1) {
      reviewIdx++;
      renderReviewNav();
      renderReviewDetail();
    }
  });
}

export async function ensureFgCuratorData() {
  if (!allSets.length) {
    allSets = await loadAllInferenceSets();
    reloadReviewItems();
  }
  return allSets;
}
