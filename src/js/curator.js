/**
 * Curator mode: gallery, filters, keep/reject, reorder, config export/import.
 */

import {
  loadAllInferenceSets,
  loadConfig,
  saveConfigToStorage,
  clearConfigCache,
  moleculeImagePath,
} from "./data-loader.js";

import { showPerspectiveCuratorScreen } from "./perspective-curator.js";

const STORAGE_KEY = "jufo_curator_selection";

let allSets = [];
let selectedSets = [];
let curatorConfig = { show_properties: true, show_iupac: false };

function loadSelectionFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return null;
}

function saveSelectionToStorage() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      sets: selectedSets.map((s) => ({
        strategy: s.strategy,
        set_idx: s.set_idx,
      })),
      show_properties: curatorConfig.show_properties,
      show_iupac: curatorConfig.show_iupac,
    })
  );
}

function setKey(s) {
  return `${s.strategy}_${s.set_idx}`;
}

function categoryLabel(cat) {
  const map = {
    perfect: "5/5",
    confident_wrong: "Confident wrong",
    scattered: "Scattered",
  };
  return map[cat] || cat;
}

function categoryBadgeClass(cat) {
  return `badge badge-${cat}`;
}

function renderGallery() {
  const strategy = document.getElementById("filter-strategy").value;
  const category = document.getElementById("filter-category").value;
  const keptOnly = document.getElementById("filter-kept-only").checked;
  const selectedKeys = new Set(selectedSets.map(setKey));
  const rejectedKeys = new Set(
    JSON.parse(localStorage.getItem("jufo_curator_rejected") || "[]")
  );

  const gallery = document.getElementById("curator-gallery");
  gallery.innerHTML = "";

  const filtered = allSets.filter((s) => {
    if (strategy && s.strategy !== strategy) return false;
    if (category && s._category !== category) return false;
    if (keptOnly && !selectedKeys.has(setKey(s))) return false;
    return true;
  });

  for (const setData of filtered) {
    const key = setKey(setData);
    const card = document.createElement("article");
    card.className = "curator-card";
    if (selectedKeys.has(key)) card.classList.add("kept");
    if (rejectedKeys.has(key)) card.classList.add("rejected");

    const header = document.createElement("div");
    header.className = "curator-card-head";
    header.innerHTML = `
      <span class="id">${setData.strategy} #${setData.set_idx}</span>
      <span>${categoryLabel(setData._category)}</span>
      <span>${setData._correctCount}/${setData._totalSeeds}</span>
    `;
    card.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "curator-mini";
    setData.molecules.forEach((mol, i) => {
      const cell = document.createElement("div");
      if (i === setData.ground_truth_ooo_idx) cell.classList.add("gt");
      const img = document.createElement("img");
      img.src = moleculeImagePath(setData.strategy, setData.set_idx, i);
      img.alt = `#${i + 1}`;
      cell.appendChild(img);
      grid.appendChild(cell);
    });
    card.appendChild(grid);

    const stats = document.createElement("p");
    stats.className = "curator-stats";
    const gtMol = setData.molecules[setData.ground_truth_ooo_idx];
    const gtFg = gtMol?.fg_primary || setData._fgAnalysis?.gt_fg;
    const modelIdx = setData._modelPredIdx;
    const modelFg = setData.molecules[modelIdx]?.fg_primary;
    let statsText =
      `GT: #${setData.ground_truth_ooo_idx + 1}` +
      (gtFg ? ` (${gtFg})` : "") +
      ` · Modell: #${modelIdx + 1}` +
      (modelFg ? ` (${modelFg})` : "");
    if (setData._modelAltCorrect) statsText += " · alt. korrekt";
    stats.textContent = statsText;
    card.appendChild(stats);

    const actions = document.createElement("div");
    actions.className = "curator-actions";
    actions.innerHTML = `
      <button type="button" data-action="keep">+</button>
      <button type="button" data-action="reject">−</button>
      <button type="button" data-action="add">Auswahl</button>
    `;
    actions.querySelector('[data-action="keep"]').addEventListener("click", () => keepSet(setData));
    actions.querySelector('[data-action="reject"]').addEventListener("click", () => rejectSet(setData));
    actions.querySelector('[data-action="add"]').addEventListener("click", () => addToSelection(setData));
    card.appendChild(actions);

    gallery.appendChild(card);
  }
}

function keepSet(setData) {
  rejectSetRemove(setData);
  addToSelection(setData);
}

function rejectSet(setData) {
  const rejected = new Set(JSON.parse(localStorage.getItem("jufo_curator_rejected") || "[]"));
  rejected.add(setKey(setData));
  localStorage.setItem("jufo_curator_rejected", JSON.stringify([...rejected]));
  removeFromSelection(setData);
  renderGallery();
  renderSelectedList();
}

function rejectSetRemove(setData) {
  const rejected = new Set(JSON.parse(localStorage.getItem("jufo_curator_rejected") || "[]"));
  rejected.delete(setKey(setData));
  localStorage.setItem("jufo_curator_rejected", JSON.stringify([...rejected]));
}

function addToSelection(setData) {
  const key = setKey(setData);
  if (!selectedSets.some((s) => setKey(s) === key)) {
    selectedSets.push(setData);
    saveSelectionToStorage();
    renderGallery();
    renderSelectedList();
  }
}

function removeFromSelection(setData) {
  const key = setKey(setData);
  selectedSets = selectedSets.filter((s) => setKey(s) !== key);
  saveSelectionToStorage();
}

function renderSelectedList() {
  const list = document.getElementById("selected-list");
  list.innerHTML = "";
  document.getElementById("selected-count").textContent = selectedSets.length;

  selectedSets.forEach((setData, idx) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span>${idx + 1}. ${setData.strategy} #${setData.set_idx}</span>
      <span class="btns">
        <button type="button" data-dir="up" ${idx === 0 ? "disabled" : ""}>↑</button>
        <button type="button" data-dir="down" ${idx === selectedSets.length - 1 ? "disabled" : ""}>↓</button>
        <button type="button" class="btn-remove">×</button>
      </span>
    `;
    li.querySelector('[data-dir="up"]').addEventListener("click", () => moveSelected(idx, -1));
    li.querySelector('[data-dir="down"]').addEventListener("click", () => moveSelected(idx, 1));
    li.querySelector(".btn-remove").addEventListener("click", () => {
      removeFromSelection(setData);
      renderGallery();
      renderSelectedList();
    });
    list.appendChild(li);
  });
}

function moveSelected(idx, delta) {
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= selectedSets.length) return;
  const tmp = selectedSets[idx];
  selectedSets[idx] = selectedSets[newIdx];
  selectedSets[newIdx] = tmp;
  saveSelectionToStorage();
  renderSelectedList();
}

function exportConfig() {
  const config = {
    sets: selectedSets.map((s) => ({
      strategy: s.strategy,
      set_idx: s.set_idx,
    })),
    show_properties: curatorConfig.show_properties,
    show_iupac: curatorConfig.show_iupac,
  };

  const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "config.json";
  a.click();
  URL.revokeObjectURL(url);

  saveConfigToStorage(config);
  clearConfigCache();
  window.dispatchEvent(new CustomEvent("jufo-config-updated", { detail: config }));
}

async function importConfig(file) {
  const text = await file.text();
  const config = JSON.parse(text);
  curatorConfig.show_properties = config.show_properties ?? true;
  curatorConfig.show_iupac = config.show_iupac ?? false;
  document.getElementById("toggle-properties").checked = curatorConfig.show_properties;
  document.getElementById("toggle-iupac").checked = curatorConfig.show_iupac;

  selectedSets = [];
  for (const entry of config.sets || []) {
    const found = allSets.find(
      (s) => s.strategy === entry.strategy && s.set_idx === entry.set_idx
    );
    if (found) selectedSets.push(found);
  }
  saveSelectionToStorage();
  saveConfigToStorage(config);
  clearConfigCache();
  renderGallery();
  renderSelectedList();
}

let curatorInitPromise = null;

async function initCuratorCore() {
  allSets = await loadAllInferenceSets();

  const config = await loadConfig();
  curatorConfig.show_properties = config.show_properties ?? true;
  curatorConfig.show_iupac = config.show_iupac ?? false;

  const stored = loadSelectionFromStorage();
  if (stored?.sets?.length) {
    selectedSets = stored.sets
      .map((e) => allSets.find((s) => s.strategy === e.strategy && s.set_idx === e.set_idx))
      .filter(Boolean);
    if (stored.show_properties != null) curatorConfig.show_properties = stored.show_properties;
    if (stored.show_iupac != null) curatorConfig.show_iupac = stored.show_iupac;
  } else {
    selectedSets = (config.sets || [])
      .map((e) => allSets.find((s) => s.strategy === e.strategy && s.set_idx === e.set_idx))
      .filter(Boolean);
  }

  document.getElementById("toggle-properties").checked = curatorConfig.show_properties;
  document.getElementById("toggle-iupac").checked = curatorConfig.show_iupac;

  document.getElementById("filter-strategy").addEventListener("change", renderGallery);
  document.getElementById("filter-category").addEventListener("change", renderGallery);
  document.getElementById("filter-kept-only").addEventListener("change", renderGallery);

  document.getElementById("toggle-properties").addEventListener("change", (e) => {
    curatorConfig.show_properties = e.target.checked;
    saveSelectionToStorage();
  });
  document.getElementById("toggle-iupac").addEventListener("change", (e) => {
    curatorConfig.show_iupac = e.target.checked;
    saveSelectionToStorage();
  });

  document.getElementById("btn-export-config").addEventListener("click", exportConfig);
  document.getElementById("import-config").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importConfig(file);
    e.target.value = "";
  });

  document.getElementById("btn-open-perspective-review")?.addEventListener("click", () => {
    showPerspectiveCuratorScreen().catch((err) => {
      console.error("Sicht-Kurator:", err);
      alert(`Sicht-Kurator konnte nicht geladen werden: ${err.message}`);
    });
  });

  renderGallery();
  renderSelectedList();
}

/** Lazy init — loads all 200 sets only when curator is actually opened. */
export function ensureCuratorReady() {
  if (!curatorInitPromise) {
    curatorInitPromise = initCuratorCore().catch((err) => {
      curatorInitPromise = null;
      throw err;
    });
  }
  return curatorInitPromise;
}

function activateScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.id === id);
  });
}

export async function showCuratorScreen() {
  await ensureCuratorReady();
  activateScreen("screen-curator");
  renderGallery();
  renderSelectedList();
}
