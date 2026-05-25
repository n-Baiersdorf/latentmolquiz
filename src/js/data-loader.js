/**
 * Data loading and set utilities for JuFo MultiMol OOO-Quiz.
 */

const APP_BASE = new URL("../", import.meta.url).href;
const DATA_BASE = `${APP_BASE}data/`;
const GALLERY_BASE = `${APP_BASE}gallery/`;
const POOL_STRATEGIES = ["scaffold_similar", "random"];

function assetVersion() {
  const link = document.querySelector('link[href*="styles.css"]');
  if (!link?.href) return "";
  try {
    return new URL(link.href).searchParams.get("v") || "";
  } catch {
    return "";
  }
}

export function galleryImageUrl(filename) {
  const version = assetVersion();
  const query = version ? `?v=${encodeURIComponent(version)}` : "";
  return `${GALLERY_BASE}${filename}${query}`;
}

export { APP_BASE, DATA_BASE, GALLERY_BASE };
const LOAD_BATCH_SIZE = 30;

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
  const resp = await fetch(`${APP_BASE}config.json`, { cache: "no-store" });
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

export async function loadPoolManifest() {
  const resp = await fetch(`${DATA_BASE}set_manifest.json`, { cache: "no-store" });
  if (!resp.ok) throw new Error("Set-Pool (Manifest) konnte nicht geladen werden");
  return resp.json();
}

export function buildPoolEntries(manifest, curatedKeys) {
  const curated = new Set(curatedKeys);
  const entries = [];
  for (const strategy of POOL_STRATEGIES) {
    for (const setIdx of manifest.strategies?.[strategy] || []) {
      const key = `${strategy}_${setIdx}`;
      if (!curated.has(key)) entries.push({ strategy, set_idx: setIdx });
    }
  }
  return entries;
}

export async function loadPoolSetEntry(entry) {
  const data = await loadSetData(entry.strategy, entry.set_idx);
  if (!data) return null;
  return enrichSetMeta(data);
}

export async function loadAllInferenceSets(onProgress) {
  if (allSetsCache) return allSetsCache;

  let jobs = [];
  try {
    const resp = await fetch(`${DATA_BASE}set_manifest.json`, { cache: "no-store" });
    if (resp.ok) {
      const manifest = await resp.json();
      for (const strategy of POOL_STRATEGIES) {
        for (const setIdx of manifest.strategies?.[strategy] || []) {
          jobs.push({ strategy, setIdx });
        }
      }
    }
  } catch {
    /* fallback below */
  }

  if (!jobs.length) {
    for (const strategy of POOL_STRATEGIES) {
      for (let setIdx = 0; setIdx < 100; setIdx++) {
        jobs.push({ strategy, setIdx });
      }
    }
  }

  const sets = [];
  for (let offset = 0; offset < jobs.length; offset += LOAD_BATCH_SIZE) {
    const chunk = jobs.slice(offset, offset + LOAD_BATCH_SIZE);
    const results = await Promise.all(
      chunk.map(({ strategy, setIdx }) => loadSetData(strategy, setIdx))
    );
    for (const data of results) {
      if (data) sets.push(enrichSetMeta(data));
    }
    if (onProgress) {
      onProgress(Math.min(offset + chunk.length, jobs.length), jobs.length);
    }
  }

  allSetsCache = sets;
  return allSetsCache;
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
  return galleryImageUrl(`${strategy}_set${setIdx}_mol${molIdx}.png`);
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
