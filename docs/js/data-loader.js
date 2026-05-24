/**
 * Data loading and set utilities for JuFo MultiMol OOO-Quiz.
 */

const DATA_BASE = "./data/";
const GALLERY_BASE = "./gallery/";

let allSetsCache = null;
let configCache = null;

export async function loadConfig() {
  if (configCache) return configCache;
  const stored = localStorage.getItem("jufo_config");
  if (stored) {
    try {
      configCache = JSON.parse(stored);
      return configCache;
    } catch {
      /* fall through */
    }
  }
  const resp = await fetch("./config.json", { cache: "no-store" });
  if (!resp.ok) throw new Error("config.json konnte nicht geladen werden");
  configCache = await resp.json();
  return configCache;
}

export function saveConfigToStorage(config) {
  configCache = config;
  localStorage.setItem("jufo_config", JSON.stringify(config));
}

export function clearConfigCache() {
  configCache = null;
}

export function clearAllSetsCache() {
  allSetsCache = null;
}

export async function loadAllInferenceSets() {
  if (allSetsCache) return allSetsCache;

  const strategies = ["scaffold_similar", "random"];
  const sets = [];
  for (const strategy of strategies) {
    for (let i = 0; i < 100; i++) {
      const data = await loadSetData(strategy, i);
      if (data) sets.push(enrichSetMeta(data));
    }
  }
  allSetsCache = sets;
  return sets;
}

export async function loadSetData(strategy, setIdx, retries = 2) {
  const filename = `inference_${strategy}_set${setIdx}.json`;
  const url = `${DATA_BASE}${filename}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, { cache: "no-store" });
      if (resp.ok) return await resp.json();
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      return null;
    } catch {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        continue;
      }
      return null;
    }
  }
  return null;
}

export async function loadConfiguredSets(config) {
  const entries = config.sets || [];
  const results = await Promise.all(
    entries.map((entry) => loadSetData(entry.strategy, entry.set_idx))
  );
  return results.filter(Boolean).map(enrichSetMeta);
}

export function enrichSetMeta(data) {
  const perSeed = data.per_seed || {};
  const seedEntries = Object.entries(perSeed).map(([seedId, s]) => ({
    seedId,
    predIdx: s.ooo_pred_idx,
    correct: s.correct ?? s.ooo_pred_idx === data.ground_truth_ooo_idx,
  }));
  const seedPreds = seedEntries.map((s) => s.predIdx);
  const gt = data.ground_truth_ooo_idx;
  const correctCount = seedPreds.filter((p) => p === gt).length;
  const totalSeeds = seedPreds.length || 5;
  const uniquePreds = new Set(seedPreds).size;

  let category = "scattered";
  if (correctCount === totalSeeds) category = "perfect";
  else if (correctCount === 0 && uniquePreds === 1) category = "confident_wrong";

  const votes = {};
  for (const p of seedPreds) votes[p] = (votes[p] || 0) + 1;
  let modelPredIdx = gt;
  let maxVotes = 0;
  for (const [idx, count] of Object.entries(votes)) {
    if (count > maxVotes) {
      maxVotes = count;
      modelPredIdx = Number(idx);
    }
  }

  const wrongPredCols = [...new Set(seedPreds.filter((p) => p !== gt))];
  const fgAnalysis = data.fg_analysis || null;

  return {
    ...data,
    _seedEntries: seedEntries,
    _correctCount: correctCount,
    _totalSeeds: totalSeeds,
    _modelVoteCount: maxVotes,
    _category: category,
    _modelPredIdx: modelPredIdx,
    _wrongPredCols: wrongPredCols,
    _fgAnalysis: fgAnalysis,
    _modelAltCorrect: fgAnalysis?.model_alt_correct ?? false,
  };
}

export function moleculeImagePath(strategy, setIdx, molIdx) {
  return `${GALLERY_BASE}${strategy}_set${setIdx}_mol${molIdx}.png`;
}

export function formatProperty(prop) {
  if (!prop || prop.value == null) return "";
  const val = typeof prop.value === "number" ? prop.value.toFixed(2) : prop.value;
  return `${val} ${prop.unit || ""}`.trim();
}

export function getSeedRingHTML(correctCount, totalSeeds) {
  let html = "";
  for (let i = 0; i < totalSeeds; i++) {
    const cls = i < correctCount ? "seed-ring correct" : "seed-ring wrong";
    html += `<span class="${cls}" title="Seed ${i + 1}"></span>`;
  }
  return html;
}

export function computeOffDiagonalRange(matrix) {
  let vmin = Infinity;
  let vmax = -Infinity;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      if (i === j) continue;
      const v = matrix[i][j];
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
  }
  if (!isFinite(vmin)) {
    vmin = 0;
    vmax = 1;
  }
  return { vmin, vmax };
}

export function isCuratorMode() {
  return new URLSearchParams(window.location.search).get("mode") === "curator";
}
