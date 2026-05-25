/**
 * Kurator: algorithmische „Sicht des Modells“-Vorschläge prüfen, ausblenden oder korrigieren.
 */

import { loadAllInferenceSets, moleculeImagePath } from "./data-loader.js";
import {
  exportPerspectiveOverridesForBuild,
  getEffectiveModelPerspective,
  listPerspectiveReviewCandidates,
  loadPerspectiveOverrides,
  savePerspectiveOverrides,
} from "./model-perspective.js";

let allSets = [];
let reviewItems = [];
let reviewIdx = 0;
let filterStatus = "pending";

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function reviewStatus(item) {
  const stored = item.stored;
  if (!stored) return "pending";
  return stored.status || "pending";
}

function filteredItems() {
  if (filterStatus === "all") return reviewItems;
  return reviewItems.filter((item) => reviewStatus(item) === filterStatus);
}

function currentItem() {
  const items = filteredItems();
  if (!items.length) return null;
  return items[Math.min(reviewIdx, items.length - 1)];
}

function reloadReviewItems() {
  reviewItems = listPerspectiveReviewCandidates(allSets, loadPerspectiveOverrides());
}

function renderReviewNav() {
  const items = filteredItems();
  const label = document.getElementById("persp-review-progress");
  const list = document.getElementById("persp-review-list");
  if (label) {
    label.textContent = items.length
      ? `${reviewIdx + 1} / ${items.length}`
      : "Keine Treffer";
  }
  if (!list) return;

  list.innerHTML = items
    .map((item, i) => {
      const status = reviewStatus(item);
      const active = i === reviewIdx ? " active" : "";
      return `<button type="button" class="persp-review-item${active}" data-idx="${i}">
        <span class="persp-review-item-id">${escapeHtml(item.key)}</span>
        <span class="persp-review-item-status status-${status}">${escapeHtml(status)}</span>
      </button>`;
    })
    .join("");

  list.querySelectorAll(".persp-review-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      reviewIdx = Number(btn.dataset.idx);
      renderReviewDetail();
      renderReviewNav();
    });
  });
}

function renderMiniMols(setData, modelIdx, gtIdx) {
  return setData.molecules
    .map((_, i) => {
      const cls = ["persp-mini-mol", i === gtIdx ? "gt" : "", i === modelIdx ? "model" : ""]
        .filter(Boolean)
        .join(" ");
      return `<div class="${cls}">
        <img src="${moleculeImagePath(setData.strategy, setData.set_idx, i)}" alt="Molekül ${i + 1}" loading="lazy">
        <span>#${i + 1}</span>
      </div>`;
    })
    .join("");
}

function storedText(item) {
  return item.stored?.perspective?.paragraphs?.[0] || null;
}

function setReviewStatus(key, entry) {
  const overrides = loadPerspectiveOverrides();
  overrides[key] = entry;
  savePerspectiveOverrides(overrides);
  reloadReviewItems();
}

function advanceReview() {
  const items = filteredItems();
  if (reviewIdx < items.length - 1) reviewIdx++;
  renderReviewDetail();
  renderReviewNav();
}

function renderReviewDetail() {
  const panel = document.getElementById("persp-review-detail");
  if (!panel) return;

  const item = currentItem();
  if (!item) {
    panel.innerHTML = `<p class="muted">Keine Sets mit algorithmischem Sicht-Vorschlag für diesen Filter.</p>`;
    return;
  }

  const { setData, key, candidate } = item;
  const fg = setData._fgAnalysis || {};
  const gtIdx = setData.ground_truth_ooo_idx;
  const modelIdx = fg.model_pred_idx ?? setData._modelPredIdx;
  const status = reviewStatus(item);
  const effective = getEffectiveModelPerspective(setData);
  const text = candidate?.paragraphs?.[0] || "(kein Text)";
  const meta = candidate?._meta;
  const metaLine = meta
    ? `Modell #${modelIdx + 1} · ${meta.votes} Seeds · ${meta.mode}${meta.criterion?.length ? `: ${meta.criterion[0]}` : ""}`
    : "";

  panel.innerHTML = `
    <div class="persp-review-head">
      <h2>${escapeHtml(key)}</h2>
      <p class="muted">${escapeHtml(metaLine)}</p>
    </div>
    <div class="persp-review-mols">${renderMiniMols(setData, modelIdx, gtIdx)}</div>
    <div class="persp-review-box">
      <p class="persp-review-label">Algorithmischer Vorschlag</p>
      <p class="persp-review-text">${escapeHtml(text)}</p>
    </div>
    <div class="persp-review-box">
      <p class="persp-review-label">Aktuell im Quiz</p>
      <p class="persp-review-text">${effective ? escapeHtml(effective.paragraphs?.[0] || "") : "— ausgeblendet —"}</p>
    </div>
    <label class="persp-review-edit-label">Eigener Text (optional)
      <textarea id="persp-review-edit" rows="3">${escapeHtml(storedText(item) || text)}</textarea>
    </label>
    <div class="persp-review-actions">
      <button type="button" id="persp-btn-approve" class="action small">✓ OK</button>
      <button type="button" id="persp-btn-hide" class="nav-btn">✗ Ausblenden</button>
      <button type="button" id="persp-btn-save" class="nav-btn">✎ Text übernehmen</button>
      <button type="button" id="persp-btn-flag" class="nav-btn">⚠ Markieren</button>
    </div>
    <p class="persp-review-status-line">Status: <strong>${escapeHtml(status)}</strong></p>
    <div class="persp-review-nav-row">
      <button type="button" id="persp-btn-prev" class="nav-btn">← Zurück</button>
      <button type="button" id="persp-btn-next" class="nav-btn">Weiter →</button>
    </div>`;

  document.getElementById("persp-btn-approve")?.addEventListener("click", () => {
    setReviewStatus(key, { status: "approved" });
    advanceReview();
  });
  document.getElementById("persp-btn-hide")?.addEventListener("click", () => {
    setReviewStatus(key, { status: "suppressed" });
    advanceReview();
  });
  document.getElementById("persp-btn-save")?.addEventListener("click", () => {
    const custom = document.getElementById("persp-review-edit")?.value.trim();
    if (!custom) return;
    setReviewStatus(key, {
      status: "edited",
      perspective: { title: "Sicht des Modells", paragraphs: [custom], auto: true },
    });
    advanceReview();
  });
  document.getElementById("persp-btn-flag")?.addEventListener("click", () => {
    setReviewStatus(key, { status: "flagged" });
    advanceReview();
  });
  document.getElementById("persp-btn-prev")?.addEventListener("click", () => {
    if (reviewIdx > 0) reviewIdx--;
    renderReviewDetail();
    renderReviewNav();
  });
  document.getElementById("persp-btn-next")?.addEventListener("click", () => advanceReview());
}

function renderReviewSummary() {
  const el = document.getElementById("persp-review-summary");
  if (!el) return;
  const stored = Object.keys(loadPerspectiveOverrides()).length;
  el.textContent = `${reviewItems.length} Vorschläge · ${stored} Entscheidungen gespeichert (localStorage)`;
}

function renderPerspectiveReview() {
  reloadReviewItems();
  const items = filteredItems();
  if (reviewIdx >= items.length) reviewIdx = Math.max(0, items.length - 1);
  renderReviewSummary();
  renderReviewNav();
  renderReviewDetail();
}

let initPromise = null;

async function initPerspectiveCurator() {
  allSets = await loadAllInferenceSets();
  reloadReviewItems();

  document.getElementById("persp-filter-status")?.addEventListener("change", (e) => {
    filterStatus = e.target.value;
    reviewIdx = 0;
    renderPerspectiveReview();
  });

  document.getElementById("persp-btn-export")?.addEventListener("click", () => {
    const py = exportPerspectiveOverridesForBuild();
    const blob = new Blob([py], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "perspective_overrides.py.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById("persp-btn-clear")?.addEventListener("click", () => {
    if (window.confirm("Alle gespeicherten Sicht-Entscheidungen löschen?")) {
      savePerspectiveOverrides({});
      reviewIdx = 0;
      renderPerspectiveReview();
    }
  });

  document.getElementById("btn-persp-back-curator")?.addEventListener("click", () => {
    document.getElementById("screen-perspective-curator")?.classList.remove("active");
    document.getElementById("screen-curator")?.classList.add("active");
  });

  renderPerspectiveReview();
}

export async function showPerspectiveCuratorScreen() {
  if (!initPromise) {
    await (initPromise = initPerspectiveCurator().catch((err) => {
      initPromise = null;
      throw err;
    }));
  } else {
    renderPerspectiveReview();
  }

  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.id === "screen-perspective-curator");
  });
}
