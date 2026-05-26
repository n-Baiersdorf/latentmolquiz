/**
 * Presentation mode — minimal quiz flow.
 */

import {
  loadConfig,
  loadConfiguredSets,
  loadPoolManifest,
  buildPoolEntries,
  loadPoolSetEntry,
  clearAllSetsCache,
  galleryImageUrl,
  moleculeImagePath,
  formatProperty,
  isCuratorMode,
} from "./data-loader.js";
import { initFgTutorial, closeFgTutorial } from "./fg-tutorial.js";
import { renderPeaHeatmap } from "./pea-heatmap.js";
import { showCuratorScreen, ensureCuratorReady } from "./curator.js";
import { getEffectiveModelPerspective } from "./model-perspective.js";
import {
  bindDetailsKeyHintSync,
  initKeyHintsLayout,
  isCompactKeyHints,
  labelWithKeyHint,
  setButtonKeyHint,
  syncDetailsKeyHint,
} from "./key-hints.js";
const SCREEN_ID_BY_NAME = {
  intro: "screen-intro",
  quiz: "screen-quiz",
  outro: "screen-outro",
  speedrunOutro: "screen-speedrun-outro",
  info: "screen-info",
  curator: "screen-curator",
};

const SCREENS = {
  intro: document.getElementById("screen-intro"),
  quiz: document.getElementById("screen-quiz"),
  outro: document.getElementById("screen-outro"),
  speedrunOutro: document.getElementById("screen-speedrun-outro"),
  info: document.getElementById("screen-info"),
  curator: document.getElementById("screen-curator"),
};

const POOL_SPEEDRUN_DURATION_MS = 3 * 60 * 1000;
const SPEEDRUN_PICK_ADVANCE_MS = 380;
const SPEEDRUN_PICK_ADVANCE_WRONG_MS = 920;

const GLOSSARY_BACKDROP = document.getElementById("fg-glossary-backdrop");
const GLOSSARY_BODY = document.getElementById("fg-glossary-body");

const state = {
  config: null,
  curatedSets: [],
  sets: [],
  poolEntries: [],
  /** Shuffle an: Weiter/←→ folgen gemischter Permutation statt Set-Nummern-Reihe. */
  poolShuffleOn: false,
  poolOrder: [],
  poolOrderPos: 0,
  poolSetData: null,
  poolCache: new Map(),
  poolPrefetchInFlight: new Set(),
  poolLoading: false,
  quizTransitionLock: false,
  currentIdx: 0,
  juryAnswers: [],
  resolved: false,
  mode: "curated",
  speedrunScore: 0,
  speedrunEndsAt: null,
  speedrunTimeLeftMs: 0,
  speedrunEnded: false,
  speedrunPickBusy: false,
  speedrunTimerInterval: null,
  currentGlossary: null,
  infoReturn: "outro",
  appReady: false,
  loadError: null,
};

function showScreen(name) {
  const targetId = SCREEN_ID_BY_NAME[name];
  if (!targetId) return;
  document.querySelectorAll("#app > section.screen").forEach((el) => {
    el.classList.toggle("active", el.id === targetId);
  });
  SCREENS.quiz?.classList.remove("quiz-set-in", "quiz-set-out");
  placeThemeButton(name);
  refreshKeyHintsLayout();
}

const THEME_SLOTS = {
  intro: "theme-slot-intro",
  quiz: "theme-slot-quiz",
  outro: "theme-slot-outro",
  speedrunOutro: "theme-slot-speedrun-outro",
  info: "theme-slot-info",
  curator: "theme-slot-curator",
};

function placeThemeButton(screenName) {
  const btn = document.getElementById("btn-theme");
  const slot = document.getElementById(THEME_SLOTS[screenName] || THEME_SLOTS.intro);
  if (btn && slot && btn.parentElement !== slot) {
    slot.appendChild(btn);
  }
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const QUIZ_SET_OUT_MS = 140;
const QUIZ_SET_IN_MS = 320;

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setPoolNavBusy(busy) {
  if (!isEndlessPoolMode()) return;
  for (const id of ["pool-shuffle-toggle", "pool-jump-input"]) {
    document.getElementById(id)?.toggleAttribute("disabled", busy);
  }
}

async function runQuizSetTransition(updateFn) {
  const screen = SCREENS.quiz;
  if (!screen || prefersReducedMotion()) {
    try {
      await updateFn();
    } finally {
      schedulePoolPrefetch();
    }
    return;
  }

  state.quizTransitionLock = true;
  setPoolNavBusy(true);
  try {
    screen.classList.add("quiz-set-out");
    await delay(QUIZ_SET_OUT_MS);
    screen.classList.remove("quiz-set-out");
    await updateFn();
    screen.classList.add("quiz-set-in");
    await delay(QUIZ_SET_IN_MS);
    screen.classList.remove("quiz-set-in");
  } finally {
    state.quizTransitionLock = false;
    setPoolNavBusy(false);
    schedulePoolPrefetch();
  }
}

function playQuizSetEnter() {
  const screen = SCREENS.quiz;
  if (!screen || prefersReducedMotion()) return;
  screen.classList.add("quiz-set-in");
  window.setTimeout(() => screen.classList.remove("quiz-set-in"), QUIZ_SET_IN_MS);
}

function isEndlessPoolMode() {
  return state.mode === "endless";
}

function isPoolSpeedrunMode() {
  return state.mode === "pool-speedrun";
}

function isPoolMode() {
  return isEndlessPoolMode() || isPoolSpeedrunMode();
}

function formatCountdownMs(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function stopSpeedrunTimer() {
  if (state.speedrunTimerInterval != null) {
    window.clearInterval(state.speedrunTimerInterval);
    state.speedrunTimerInterval = null;
  }
}

function startPoolSpeedrunCountdown() {
  stopSpeedrunTimer();
  state.speedrunEndsAt = performance.now() + POOL_SPEEDRUN_DURATION_MS;
  state.speedrunTimeLeftMs = POOL_SPEEDRUN_DURATION_MS;
  state.speedrunEnded = false;
  const el = document.getElementById("speedrun-timer");
  const tick = () => {
    if (!isPoolSpeedrunMode() || state.speedrunEnded) return;
    const left = state.speedrunEndsAt - performance.now();
    state.speedrunTimeLeftMs = left;
    if (left <= 0) {
      endPoolSpeedrun();
      return;
    }
    if (el) {
      el.textContent = formatCountdownMs(left);
      el.classList.toggle("speedrun-timer-low", left < 30_000);
    }
    updateSpeedrunScoreLive();
  };
  tick();
  state.speedrunTimerInterval = window.setInterval(tick, 200);
}

function updateSpeedrunScoreLive() {
  const el = document.getElementById("speedrun-score-live");
  if (el) el.textContent = `Richtig: ${state.speedrunScore}`;
}

/** FG, die nur am Ausreißer (GT) vorkommt — fairer Speedrun-Hinweis in Feedback. */
function findGtUniqueFgCue(setData) {
  if (!setData?.molecules?.length) return null;
  const gt = setData.ground_truth_ooo_idx;
  const counts = new Map();
  for (const mol of setData.molecules) {
    for (const fg of mol.fg_labels_de || []) {
      counts.set(fg, (counts.get(fg) || 0) + 1);
    }
  }
  for (const [fgDe, count] of counts) {
    if (count !== 1) continue;
    const molIdx = setData.molecules.findIndex((m) => (m.fg_labels_de || []).includes(fgDe));
    if (molIdx === gt) return { fgDe, molIdx };
  }
  return null;
}

function isSpeedrunPickCorrect(setData, molIdx) {
  const cue = findGtUniqueFgCue(setData);
  if (cue) return molIdx === cue.molIdx;
  return molIdx === setData.ground_truth_ooo_idx;
}

function buildSpeedrunWrongFeedback(setData, pickedIdx) {
  const gt = setData.ground_truth_ooo_idx;
  const cue = findGtUniqueFgCue(setData);
  if (cue) {
    return `Richtig: #${gt + 1} — nur dort: „${cue.fgDe}“`;
  }
  const gtMol = setData.molecules[gt];
  const primary = gtMol?.fg_primary || setData._fgAnalysis?.gt_fg;
  if (primary) return `Ausreißer: #${gt + 1} (${primary})`;
  if (cue) return `Ausreißer: #${gt + 1} — „${cue.fgDe}“ nur einmal`;
  return `Ausreißer war #${gt + 1}, nicht #${pickedIdx + 1}`;
}

function setSpeedrunFeedback(text) {
  const el = document.getElementById("speedrun-feedback");
  if (!el) return;
  if (!text) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }
  el.textContent = text;
  el.classList.remove("hidden");
}

async function findNextSpeedrunPoolIndex(fromIdx) {
  let idx = fromIdx;
  while (idx < state.poolEntries.length) {
    await ensurePoolSetAt(idx);
    if (findGtUniqueFgCue(getCurrentSetData())) return idx;
    idx++;
  }
  return idx;
}

function updateQuizChrome() {
  const poolBar = document.getElementById("pool-toolbar");
  const timer = document.getElementById("speedrun-timer");
  const scoreLive = document.getElementById("speedrun-score-live");
  poolBar?.classList.toggle("hidden", !isEndlessPoolMode());
  timer?.classList.toggle("hidden", !isPoolSpeedrunMode());
  scoreLive?.classList.toggle("hidden", !isPoolSpeedrunMode());
  if (isEndlessPoolMode()) {
    updatePoolToolbarFields();
    updatePoolShuffleToggleUi();
  }
  if (isPoolSpeedrunMode()) updateSpeedrunScoreLive();
  updateQuizKeyHints();
}

function updateQuizTopHintsEl() {
  const el = document.getElementById("quiz-kbd-hints");
  if (!el) return;
  if (!SCREENS.quiz?.classList.contains("active")) {
    el.innerHTML = "";
    el.classList.add("hidden");
    return;
  }

  const items = [];
  if (isPoolSpeedrunMode()) {
    items.push(["1–4", "wählen"], ["H", "Menü"]);
  } else {
    items.push(["1–4", "Molekül"], ["←", "Set"], ["→", "Set"]);
    if (isEndlessPoolMode()) items.push(["R", "Shuffle"]);
    if (state.resolved) {
      items.push(["F", "FG-Tabelle"], ["P", "PEA"], ["Enter", "Weiter"]);
    }
    items.push(["H", "Menü"]);
  }

  el.innerHTML = items
    .map(
      ([key, text]) =>
        `<span class="quiz-kbd-item"><kbd class="key-hint">${key}</kbd> ${text}</span>`
    )
    .join('<span class="quiz-kbd-sep" aria-hidden="true">·</span>');
  el.classList.toggle("hidden", isCompactKeyHints());
}

function updateQuizKeyHints() {
  const btnNext = document.getElementById("btn-next");
  const btnHome = document.getElementById("btn-home");
  const btnPrev = document.getElementById("btn-prev");
  const shuffleBtn = document.getElementById("pool-shuffle-toggle");

  if (btnNext && !btnNext.classList.contains("hidden")) {
    setButtonKeyHint(btnNext, "Weiter →", state.resolved ? "Enter" : "→");
  }

  setButtonKeyHint(btnHome, "Hauptmenü", "H");

  if (btnPrev && !btnPrev.classList.contains("hidden")) {
    btnPrev.innerHTML = labelWithKeyHint("←", "←", { forcePrefix: true });
    btnPrev.setAttribute("aria-label", "Vorheriges Set (Pfeil links)");
  }

  if (shuffleBtn && isEndlessPoolMode()) {
    const stateEl = shuffleBtn.querySelector(".pool-shuffle-state");
    const onOff = stateEl?.textContent?.trim() || "aus";
    const label = `Shuffle: ${onOff}`;
    shuffleBtn.innerHTML = `${labelWithKeyHint(label, "R", { forcePrefix: true })}`;
    shuffleBtn.setAttribute(
      "title",
      "Gemischte Reihenfolge ein/aus — bei „an“ folgt Weiter/Enter der gemischten Permutation"
    );
  }

  syncDetailsKeyHint(document.getElementById("fg-highlight-details"));
  syncDetailsKeyHint(document.getElementById("pea-panel-details"));
  updateQuizTopHintsEl();
}

function refreshKeyHintsLayout() {
  updateQuizKeyHints();
  const btnStart = document.getElementById("btn-start");
  if (btnStart && btnStart.getAttribute("aria-busy") !== "true" && !btnStart.disabled) {
    setButtonKeyHint(btnStart, "Los geht's", "1");
  }
  document.querySelectorAll("#screen-intro .intro-link[data-label]").forEach((btn) => {
    const key = (btn.dataset.keyHint || "").replace(/^\(|\)$/g, "");
    if (btn.dataset.label) setButtonKeyHint(btn, btn.dataset.label, key || null);
  });
  const introTutorial = document.getElementById("btn-intro-fg-tutorial");
  if (introTutorial) {
    setButtonKeyHint(introTutorial, "Tutorial: Funktionelle Gruppen kurz erklärt", "2");
  }
  const introInfo = document.getElementById("btn-intro-more-info");
  if (introInfo) setButtonKeyHint(introInfo, "Mehr zum KI-Modell", "5");
  for (const id of ["btn-speedrun-outro-home", "btn-outro-home"]) {
    setButtonKeyHint(document.getElementById(id), "Hauptmenü", "H");
  }
  const theme =
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const followsSystem =
    localStorage.getItem(THEME_KEY) !== "light" && localStorage.getItem(THEME_KEY) !== "dark";
  updateThemeButton(theme, followsSystem);
}

function updatePoolToolbarFields() {
  const total = state.poolEntries.length;
  const input = document.getElementById("pool-jump-input");
  const totalEl = document.getElementById("pool-jump-total");
  const idEl = document.getElementById("pool-set-id");
  if (input) {
    input.max = String(Math.max(1, total));
    input.value = String(state.currentIdx + 1);
  }
  if (totalEl) totalEl.textContent = `/ ${total}`;
  const entry = state.poolEntries[state.currentIdx];
  if (idEl) {
    idEl.textContent = entry ? poolEntryKey(entry) : "";
  }
}

/** Set-Zähler und Pool-Sprungfeld sofort mit currentIdx synchronisieren. */
function syncPoolIndexChrome() {
  if (!isEndlessPoolMode()) return;
  updateProgress();
  updatePoolToolbarFields();
}

async function jumpToPoolIndex(idx) {
  if (!isEndlessPoolMode() || state.poolLoading || state.quizTransitionLock) return;
  const total = state.poolEntries.length;
  if (!total) return;
  const next = Math.min(Math.max(0, idx), total - 1);
  if (next === state.currentIdx) {
    syncPoolIndexChrome();
    return;
  }
  state.currentIdx = next;
  syncPoolOrderPosToCurrentIdx();
  syncPoolIndexChrome();
  const entry = state.poolEntries[next];
  const needsLoad = entry && !state.poolCache.has(poolEntryKey(entry));
  if (needsLoad) {
    const label = document.getElementById("progress-label");
    if (label) label.textContent = "Lade Set …";
  }
  try {
    await runQuizSetTransition(async () => {
      await ensurePoolSetAt(state.currentIdx);
      renderCurrentSet();
      window.scrollTo(0, 0);
    });
  } catch (err) {
    console.error(err);
    showIntroLoadError(`Set konnte nicht geladen werden: ${err.message}`);
    syncPoolIndexChrome();
  }
}

function onPoolJumpFromInput() {
  if (!isEndlessPoolMode() || state.poolLoading || state.quizTransitionLock) return;
  const input = document.getElementById("pool-jump-input");
  if (!input) return;
  const total = state.poolEntries.length;
  if (!total) return;
  const n = parseInt(input.value, 10);
  if (!Number.isFinite(n) || n < 1) return;
  const idx = Math.min(n, total) - 1;
  const display = String(idx + 1);
  if (input.value !== display) input.value = display;
  jumpToPoolIndex(idx);
}

function initPoolPermutation() {
  const n = state.poolEntries.length;
  state.poolOrder = shuffleArray(Array.from({ length: n }, (_, i) => i));
  state.poolOrderPos = 0;
}

function syncPoolOrderPosToCurrentIdx() {
  if (!state.poolOrder?.length) return;
  const pos = state.poolOrder.indexOf(state.currentIdx);
  if (pos >= 0) state.poolOrderPos = pos;
}

/** Nächstes Set in der Permutation (kein Zurücklegen bis alle einmal dran waren). */
function nextPoolPermutationIndex() {
  const n = state.poolOrder.length;
  if (n <= 1) return state.currentIdx;
  if (state.poolOrderPos < n - 1) {
    state.poolOrderPos++;
  } else {
    const prev = state.currentIdx;
    initPoolPermutation();
    if (n > 1 && state.poolOrder[0] === prev) {
      const j = 1 + Math.floor(Math.random() * (n - 1));
      [state.poolOrder[0], state.poolOrder[j]] = [state.poolOrder[j], state.poolOrder[0]];
    }
    state.poolOrderPos = 0;
  }
  return state.poolOrder[state.poolOrderPos];
}

function prevPoolPermutationIndex() {
  const n = state.poolOrder.length;
  if (n <= 1) return state.currentIdx;
  if (state.poolOrderPos > 0) {
    state.poolOrderPos--;
  } else {
    state.poolOrderPos = n - 1;
  }
  return state.poolOrder[state.poolOrderPos];
}

function updatePoolShuffleToggleUi() {
  const btn = document.getElementById("pool-shuffle-toggle");
  const stateEl = btn?.querySelector(".pool-shuffle-state");
  if (!btn) return;
  const on = state.poolShuffleOn;
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  btn.classList.toggle("is-on", on);
  if (stateEl) stateEl.textContent = on ? "an" : "aus";
  updateQuizKeyHints();
}

function togglePoolShuffle() {
  if (!isEndlessPoolMode()) return;
  state.poolShuffleOn = !state.poolShuffleOn;
  if (state.poolShuffleOn) {
    initPoolPermutation();
    syncPoolOrderPosToCurrentIdx();
    schedulePoolPrefetch(2);
  }
  updatePoolShuffleToggleUi();
}

async function navigatePoolSet(delta) {
  if (!isEndlessPoolMode() || state.poolLoading || state.quizTransitionLock) return;
  const total = state.poolEntries.length;
  if (!total) return;
  if (state.poolShuffleOn) {
    const idx = delta > 0 ? nextPoolPermutationIndex() : prevPoolPermutationIndex();
    await jumpToPoolIndex(idx);
    return;
  }
  const next = state.currentIdx + delta;
  if (next < 0 || next >= total) return;
  await jumpToPoolIndex(next);
}

function updateProgress() {
  const label = document.getElementById("progress-label");
  if (!label) return;
  if (isPoolSpeedrunMode()) {
    label.textContent = `Pool Speedrun · gemischt`;
    return;
  }
  const total = isEndlessPoolMode() ? state.poolEntries.length : state.sets.length;
  const current = state.currentIdx + 1;
  if (isEndlessPoolMode()) {
    label.textContent = `${current} / ${total} · Pool`;
  } else {
    label.textContent = `${current} / ${total}`;
  }
}

function getCurrentSetData() {
  if (isPoolMode()) return state.poolSetData;
  return state.sets[state.currentIdx];
}

function poolEntryKey(entry) {
  return `${entry.strategy}_${entry.set_idx}`;
}

async function prefetchPoolSetByIndex(idx) {
  const entry = state.poolEntries[idx];
  if (!entry) return;
  const key = poolEntryKey(entry);
  if (state.poolCache.has(key) || state.poolPrefetchInFlight.has(key)) return;
  state.poolPrefetchInFlight.add(key);
  try {
    const enriched = await loadPoolSetEntry(entry);
    if (enriched) state.poolCache.set(key, enriched);
  } catch (err) {
    console.warn("Pool-Prefetch fehlgeschlagen:", key, err);
  } finally {
    state.poolPrefetchInFlight.delete(key);
  }
}

function schedulePoolPrefetch(count = 2) {
  if (
    !state.poolShuffleOn ||
    !isEndlessPoolMode() ||
    state.poolEntries.length < 2 ||
    !state.poolOrder?.length
  ) {
    return;
  }
  const n = state.poolOrder.length;
  let pos = state.poolOrderPos;
  for (let i = 0; i < count; i++) {
    pos = pos < n - 1 ? pos + 1 : 0;
    void prefetchPoolSetByIndex(state.poolOrder[pos]);
  }
}

async function ensurePoolSetAt(idx) {
  const entry = state.poolEntries[idx];
  if (!entry) throw new Error("Set nicht im Pool");

  const key = poolEntryKey(entry);
  if (state.poolCache.has(key)) {
    state.poolSetData = state.poolCache.get(key);
    schedulePoolPrefetch();
    return;
  }

  const label = document.getElementById("progress-label");
  if (label) label.textContent = "Lade Set …";
  state.poolLoading = true;
  setPoolNavBusy(true);
  try {
    const enriched = await loadPoolSetEntry(entry);
    if (!enriched) throw new Error(`Set ${key} nicht verfügbar`);
    state.poolCache.set(key, enriched);
    state.poolSetData = enriched;
  } finally {
    state.poolLoading = false;
    setPoolNavBusy(false);
    updateProgress();
    schedulePoolPrefetch();
  }
}

const POOL_BTN_LABEL = "Weitere Sets";

function setKey(s) {
  return `${s.strategy}_${s.set_idx}`;
}

function hasFgData(setData) {
  return setData.molecules.some((m) => m.fg_labels_de?.length || m.fg_primary_de);
}

function fgPrimaryDe(mol) {
  return mol?.fg_primary_de || null;
}

const GLOSSARY_NOTE =
  "Die Einordnung folgt RDKit-Heuristiken für dieses Quiz, nicht der IUPAC-Nomenklatur. Referenzbilder sind schematische Beispiele.";

const LEGACY_GLOSSARY_DISCLAIMER =
  /^Hinweis: Chips folgen RDKit-Heuristiken für dieses Quiz, nicht IUPAC-Nomenklatur\.?\s*/;

function normalizeGlossaryEntry(raw) {
  if (raw == null) return null;
  let text = "";
  let image = null;
  if (typeof raw === "string") {
    text = raw;
  } else {
    text = raw.text || "";
    image = raw.image || null;
  }
  text = text.replace(LEGACY_GLOSSARY_DISCLAIMER, "");
  return { text, image };
}

function hasGlossaryTerm(glossary, term) {
  return normalizeGlossaryEntry(glossary?.[term]) != null;
}

function fgChips(labels, glossary = null) {
  return labels
    .map((l) => {
      const text = escapeHtml(l);
      const titleAttr = ` title="${text}"`;
      if (hasGlossaryTerm(glossary, l)) {
        return `<button type="button" class="fg-chip fg-chip-btn" data-fg="${text}" aria-label="${text} — Erklärung"${titleAttr}>${text}</button>`;
      }
      return `<span class="fg-chip"${titleAttr}>${text}</span>`;
    })
    .join(" ");
}

function molNum(n) {
  return `<span class="fg-mol-num">#${n}</span>`;
}

function formatOtherMolNums(setData, gtIdx) {
  const nums = setData.molecules
    .map((_, i) => i)
    .filter((i) => i !== gtIdx)
    .map((i) => i + 1);
  if (nums.length === 0) return "";
  if (nums.length === 1) return molNum(nums[0]);
  const last = nums.pop();
  return `${nums.map(molNum).join(", ")} und ${molNum(last)}`;
}

function buildHighlightContent(setData) {
  const fg = setData._fgAnalysis;
  const gtIdx = setData.ground_truth_ooo_idx;
  const gtNum = gtIdx + 1;
  const others = formatOtherMolNums(setData, gtIdx);
  const glossary = fg?.glossary || {};

  if (!hasFgData(setData)) {
    return {
      gtIdx,
      bodyHtml: `${others} bilden die chemische Gruppe — ${molNum(gtNum)} weicht davon ab.`,
      subHtml: null,
    };
  }

  const criterion = fg?.highlight_criterion_de || [];
  const instead = fg?.highlight_instead_de || [];
  const mode = fg?.highlight_mode;

  if (criterion.length && mode) {
    const chip = fgChips(criterion, glossary);
    const subHtml =
      instead.length && instead[0] !== criterion[0]
        ? `Stattdessen: ${fgChips(instead, glossary)}`
        : null;
    let bodyHtml;
    switch (mode) {
      case "lacks_coarse":
      case "lacks":
        bodyHtml = `${others} haben ${chip} — ${molNum(gtNum)} hat das nicht.`;
        break;
      case "shared_extra":
        bodyHtml = `${molNum(gtNum)} hat zusätzlich ${chip} — die anderen teilen den Rest der Gruppe.`;
        break;
      case "extra":
        bodyHtml = `Nur ${molNum(gtNum)} hat ${chip} — die anderen nicht.`;
        break;
      default:
        bodyHtml = `${molNum(gtNum)} ist der Ausreißer mit ${chip}.`;
    }
    return { gtIdx, bodyHtml, subHtml };
  }

  // Legacy fallback (ältere JSON ohne highlight_*)
  const shared = fg?.shared_fgs_de || [];
  const extra = (fg?.gt_extra_fgs_de || []).slice(0, 1);
  const gtLacksCoarse = fg?.gt_lacks_coarse_de || [];
  const gtLacks = (fg?.gt_lacks_fgs_de || []).slice(0, 1);
  const gtFgDe = fg?.gt_fg_de || fgPrimaryDe(setData.molecules[gtIdx]);

  if (gtLacksCoarse.length) {
    const insteadLegacy = (fg?.highlight_instead_de || fg?.gt_instead_fgs_de || []).slice(0, 1);
    return {
      gtIdx,
      bodyHtml: `${others} haben ${fgChips(gtLacksCoarse.slice(0, 1), glossary)} — ${molNum(gtNum)} hat das nicht.`,
      subHtml: insteadLegacy.length
        ? `Stattdessen: ${fgChips(insteadLegacy, glossary)}`
        : null,
    };
  }
  if (gtLacks.length) {
    return {
      gtIdx,
      bodyHtml: `${others} haben alle ${fgChips(gtLacks, glossary)} — ${molNum(gtNum)} hat das nicht.`,
      subHtml: null,
    };
  }
  if (extra.length) {
    return {
      gtIdx,
      bodyHtml: `Nur ${molNum(gtNum)} hat ${fgChips(extra, glossary)} — die anderen nicht.`,
      subHtml: null,
    };
  }
  if (gtFgDe) {
    return {
      gtIdx,
      bodyHtml: `${molNum(gtNum)} ist der Ausreißer mit ${fgChips([gtFgDe], glossary)}.`,
      subHtml: null,
    };
  }

  return {
    gtIdx,
    bodyHtml: `${molNum(gtNum)} weicht in der funktionellen Einordnung von ${others} ab.`,
    subHtml: null,
  };
}

function inlineMd(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function simpleMdToHtml(md) {
  const lines = md.split("\n");
  let html = "";
  let inTable = false;
  let inList = false;

  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith("|")) {
      closeList();
      if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;
      if (!inTable) {
        html += "<table class='info-table'>";
        inTable = true;
      }
      const cells = line.split("|").filter((c) => c.trim() !== "");
      const tag = html.endsWith("<table class='info-table'>") ? "th" : "td";
      html += "<tr>" + cells.map((c) => `<${tag}>${inlineMd(c.trim())}</${tag}>`).join("") + "</tr>";
      continue;
    }
    if (inTable) {
      html += "</table>";
      inTable = false;
    }
    const imgMatch = line.match(/^!\[(.*?)\]\((.*?)\)$/);
    if (imgMatch) {
      closeList();
      const altRaw = imgMatch[1];
      const src = imgMatch[2];
      const [alt, size] = altRaw.split("|").map((s) => s.trim());
      const sizeClass = size === "compact" ? " info-figure-compact" : "";
      html += `<figure class="info-figure${sizeClass}"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy"><figcaption>${escapeHtml(alt)}</figcaption></figure>`;
      continue;
    }
    if (line.startsWith("> ")) {
      closeList();
      html += `<blockquote class="info-quote">${inlineMd(line.slice(2))}</blockquote>`;
      continue;
    }
    if (line.startsWith("### ")) {
      closeList();
      html += `<h3>${inlineMd(line.slice(4))}</h3>`;
    } else if (line.startsWith("## ")) {
      closeList();
      html += `<h2>${inlineMd(line.slice(3))}</h2>`;
    } else if (line.startsWith("# ")) {
      closeList();
      html += `<h1>${inlineMd(line.slice(2))}</h1>`;
    } else if (line.startsWith("- ")) {
      if (!inList) {
        html += "<ul class='info-list'>";
        inList = true;
      }
      html += `<li>${inlineMd(line.slice(2))}</li>`;
    } else if (line.trim() === "---") {
      closeList();
      html += "<hr>";
    } else if (line.trim()) {
      closeList();
      html += `<p>${inlineMd(line)}</p>`;
    }
  }
  closeList();
  if (inTable) html += "</table>";
  return html;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fgLabelsDe(mol) {
  if (mol?.fg_labels_de?.length) return mol.fg_labels_de;
  if (mol?.fg_primary_de) return [mol.fg_primary_de];
  return [];
}

function formatFgCell(labels, uniqueSet, isGtRow, altPlausibleSet, isModelAltRow, glossary = null) {
  if (!labels.length) return "—";
  return labels
    .map((fg) => {
      const text = escapeHtml(fg);
      let cls = "fg-chip";
      if (isGtRow && uniqueSet.has(fg)) cls += " fg-unique";
      if (isModelAltRow && altPlausibleSet?.has(fg)) cls += " fg-alt-plausible";
      if (hasGlossaryTerm(glossary, fg)) {
        return `<button type="button" class="${cls} fg-chip-btn" data-fg="${text}" aria-label="${text} — Erklärung">${text}</button>`;
      }
      return `<span class="${cls}">${text}</span>`;
    })
    .join(" ");
}

function renderSeedDots(setData, molIdx, gtIdx) {
  const entries = setData._seedEntries || [];
  if (!entries.length) return null;

  const modelIdx = setData._modelPredIdx;
  const altOk = setData._modelAltCorrect && modelIdx != null && modelIdx !== gtIdx;

  const row = document.createElement("div");
  row.className = "mol-seeds";

  entries.forEach(({ predIdx }) => {
    if (predIdx !== molIdx) return;
    const dot = document.createElement("span");
    const ok = predIdx === gtIdx;
    const plausibleAlt = altOk && predIdx === modelIdx;
    dot.className = ok ? "seed-dot seed-ok" : "seed-dot seed-bad";
    if (ok) {
      dot.title = "Seed wählte den Ausreißer (definierte Ground Truth)";
    } else if (plausibleAlt) {
      dot.title =
        "Seed wählte dieses Molekül — chemisch nachvollziehbar, andere Ground-Truth-Definition";
    } else {
      dot.title = "Seed wählte dieses Molekül statt der definierten Ground Truth";
    }
    dot.textContent = "●";
    row.appendChild(dot);
  });

  if (!row.children.length) return null;
  return row;
}

function openGlossary(glossary) {
  if (!GLOSSARY_BACKDROP || !GLOSSARY_BODY || !glossary) return;
  const entries = Object.entries(glossary)
    .map(([name, raw]) => [name, normalizeGlossaryEntry(raw)])
    .filter(([, entry]) => entry);
  if (!entries.length) return;

  const itemsHtml = entries
    .map(([name, entry]) => {
      const imgHtml = entry.image
        ? `<img class="fg-glossary-img" src="${escapeHtml(galleryImageUrl(entry.image))}" alt="Beispielstruktur" loading="lazy">`
        : "";
      return `<div class="fg-glossary-item">
        <div class="fg-glossary-item-body">
          ${imgHtml}
          <div class="fg-glossary-item-text">
            <strong>${escapeHtml(name)}</strong>
            <p>${escapeHtml(entry.text)}</p>
          </div>
        </div>
      </div>`;
    })
    .join("");

  GLOSSARY_BODY.innerHTML = `${itemsHtml}<p class="fg-glossary-footnote">${escapeHtml(GLOSSARY_NOTE)}</p>`;

  GLOSSARY_BACKDROP.classList.remove("hidden");
  GLOSSARY_BACKDROP.setAttribute("aria-hidden", "false");
  document.getElementById("btn-fg-glossary-close")?.focus();
}

function openGlossaryTerm(glossary, term) {
  const entry = normalizeGlossaryEntry(glossary?.[term]);
  if (!entry) return;
  openGlossary({ [term]: entry });
}

function bindFgChipClicks(container, glossary) {
  if (!container || !glossary) return;
  container.querySelectorAll(".fg-chip-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openGlossaryTerm(glossary, btn.dataset.fg);
    });
  });
}

function closeGlossary() {
  if (!GLOSSARY_BACKDROP) return;
  GLOSSARY_BACKDROP.classList.add("hidden");
  GLOSSARY_BACKDROP.setAttribute("aria-hidden", "true");
}

function buildMoleculeCard(mol, molIdx, setData, options) {
  const {
    showProperties,
    showIupac,
    interactive,
    juryIdx,
    gtIdx,
    modelPredIdx,
    resolved,
  } = options;

  const card = document.createElement("button");
  card.type = "button";
  card.className = "mol";
  card.dataset.idx = molIdx;
  card.setAttribute("aria-label", `Molekül ${molIdx + 1}`);
  if (!interactive) card.disabled = true;

  if (resolved) {
    if (molIdx === juryIdx) {
      card.classList.add("jury", juryIdx === gtIdx ? "jury-ok" : "jury-bad");
    }
    if (molIdx === gtIdx) card.classList.add("gt");
    const modelAlt =
      setData._modelAltCorrect &&
      modelPredIdx != null &&
      modelPredIdx !== gtIdx &&
      molIdx === modelPredIdx;
    if (modelAlt) card.classList.add("model-alt");
    else if (molIdx === modelPredIdx && modelPredIdx !== gtIdx) card.classList.add("model");
  }

  const img = document.createElement("img");
  img.src = moleculeImagePath(setData.strategy, setData.set_idx, molIdx);
  img.alt = `Molekül ${molIdx + 1}`;
  img.loading = "eager";
  img.className = "mol-img";
  img.onerror = () => {
    img.style.display = "none";
    const fb = document.createElement("div");
    fb.className = "mol-img-fallback";
    fb.textContent = mol.smiles?.slice(0, 40) || `#${molIdx + 1}`;
    card.insertBefore(fb, card.firstChild);
  };
  card.appendChild(img);

  const body = document.createElement("div");
  body.className = "mol-body";

  const num = document.createElement("p");
  num.className = "mol-num";
  num.textContent = `#${molIdx + 1}`;
  body.appendChild(num);

  if (resolved) {
    if (molIdx === gtIdx) {
      const tag = document.createElement("p");
      tag.className = "mol-tag tag-gt";
      tag.textContent = "★ Ausreißer";
      body.appendChild(tag);
      if (modelPredIdx === gtIdx) {
        const mtag = document.createElement("p");
        mtag.className = "mol-tag tag-model-ok";
        mtag.textContent = "Modell ✓";
        body.appendChild(mtag);
      }
    } else {
      if (molIdx === juryIdx) {
        const tag = document.createElement("p");
        tag.className = "mol-tag tag-jury";
        tag.textContent = "Deine Wahl";
        body.appendChild(tag);
      }
      if (molIdx === modelPredIdx && modelPredIdx !== gtIdx) {
        const tag = document.createElement("p");
        if (setData._modelAltCorrect) {
          tag.className = "mol-tag tag-model-alt";
          tag.textContent = "Modell plausibel";
        } else {
          tag.className = "mol-tag tag-model-bad";
          tag.textContent = "Modell ✗";
        }
        body.appendChild(tag);
      }
    }

    const seedDots = renderSeedDots(setData, molIdx, gtIdx);
    if (seedDots) body.appendChild(seedDots);
  }

  if (showIupac && mol.iupac) {
    const iupac = document.createElement("p");
    iupac.className = "mol-tag";
    iupac.textContent = mol.iupac;
    body.appendChild(iupac);
  }

  if (showProperties && mol.properties_display) {
    const props = document.createElement("div");
    props.className = "mol-props";
    const homo = mol.properties_display.homo;
    const gap = mol.properties_display.gap;
    if (homo) props.innerHTML += `<span>HOMO ${formatProperty(homo)}</span>`;
    if (gap) props.innerHTML += `<span>gap ${formatProperty(gap)}</span>`;
    body.appendChild(props);
  }

  card.appendChild(body);
  return card;
}

function expandPerspectiveText(text, glossary) {
  return text
    .split(/(\[\[[^\]]+\]\])/g)
    .map((part) => {
      const match = part.match(/^\[\[(.+)\]\]$/);
      if (match) return fgChips([match[1].trim()], glossary);
      return escapeHtml(part);
    })
    .join("");
}

function formatPerspectiveTitle(title) {
  const text = (title || "Sicht des Modells").trim();
  return text.startsWith("↗") ? text : `↗ ${text}`;
}

function perspectiveParagraphs(perspective) {
  if (Array.isArray(perspective?.paragraphs) && perspective.paragraphs.length) {
    return perspective.paragraphs;
  }
  if (perspective?.body) {
    return perspective.body.split("\n\n").map((p) => p.trim()).filter(Boolean);
  }
  return [];
}

function renderPerspectiveBlock(perspective, glossary) {
  const paragraphs = perspectiveParagraphs(perspective);
  if (!paragraphs.length) return "";

  const title = formatPerspectiveTitle(perspective.title);
  const rows = paragraphs
    .map((p, i) => {
      const cls = i === 0 ? "fg-perspective-lead" : "fg-perspective-detail";
      return `<p class="${cls}">${expandPerspectiveText(p, glossary)}</p>`;
    })
    .join("");

  return `
    <p class="fg-perspective-title">${escapeHtml(title)}</p>
    ${rows}`;
}

function renderModelPerspective(setData) {
  const el = document.getElementById("fg-model-perspective");
  if (!el) return;

  const glossary = setData._fgAnalysis?.glossary || null;
  const perspective = getEffectiveModelPerspective(setData);

  if (perspectiveParagraphs(perspective).length) {
    el.innerHTML = renderPerspectiveBlock(perspective, glossary);
    el.classList.remove("hidden");
    bindFgChipClicks(el, glossary);
    return;
  }

  el.innerHTML = "";
  el.classList.add("hidden");
}

function renderFgHighlight(setData) {
  const el = document.getElementById("fg-highlight");
  if (!el) return;
  const { gtIdx, bodyHtml, subHtml } = buildHighlightContent(setData);
  const glossary = setData._fgAnalysis?.glossary || null;

  el.innerHTML = `
    <p class="fg-highlight-title">★ Ausreißer: Molekül #${gtIdx + 1}</p>
    <p class="fg-highlight-body">${bodyHtml}</p>
    ${subHtml ? `<p class="fg-highlight-sub">${subHtml}</p>` : ""}`;

  document.getElementById("fg-highlight-details")?.classList.remove("hidden");
  bindFgChipClicks(el, glossary);
}

function clearResolutionFgPanels() {
  const highlight = document.getElementById("fg-highlight");
  if (highlight) highlight.innerHTML = "";
  const summary = document.getElementById("fg-summary");
  if (summary) summary.innerHTML = "";
  const details = document.getElementById("fg-highlight-details");
  if (details) {
    details.open = false;
    details.classList.add("hidden");
  }
}

function renderFgSummary(setData) {
  const el = document.getElementById("fg-summary");
  if (!el) return;
  el.innerHTML = "";

  const gtIdx = setData.ground_truth_ooo_idx;
  const fg = setData._fgAnalysis;
  const uniqueSet = new Set(fg?.gt_extra_fgs_de || []);
  const modelIdx = setData._modelPredIdx;
  const altPlausibleSet = new Set();
  if (setData._modelAltCorrect && modelIdx != null) {
    for (const fgName of fg?.model_exclusive_fgs_de || []) {
      altPlausibleSet.add(fgName);
    }
    for (const fgName of fg?.model_lacks_fgs_de || []) {
      altPlausibleSet.add(fgName);
    }
  }
  state.currentGlossary = fg?.glossary || null;

  let html = `<div class="fg-table-block">`;

  if (!hasFgData(setData)) {
    html += `<p class="fg-missing">Funktionelle Gruppen konnten nicht geladen werden — bitte Seite neu laden (Hard-Refresh). Was funktionelle Gruppen sind, steht unter „Mehr zum KI-Modell“.</p>`;
  }

  const rows = setData.molecules
    .map((mol, i) => {
      const labels = fgLabelsDe(mol);
      const isGtRow = i === gtIdx;
      const cls = isGtRow ? "mol-compare-gt" : "";
      return `<tr class="${cls}">
        <td>#${i + 1}</td>
        <td>${formatFgCell(
          labels,
          uniqueSet,
          isGtRow,
          altPlausibleSet,
          setData._modelAltCorrect && i === modelIdx,
          fg?.glossary
        )}</td>
      </tr>`;
    })
    .join("");

  html += `
    <table class="mol-compare-table">
      <tbody>${rows}</tbody>
    </table>
    <p class="fg-section-hint muted">Tippe auf einen Begriff für Erklärung und Beispielstruktur.</p>
  </div>`;

  el.innerHTML = html;

  bindFgChipClicks(el, fg?.glossary || null);
}

function scrollToElementWithOffset(el, offset = 8) {
  if (!el) return;
  const top = window.scrollY + el.getBoundingClientRect().top - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

function scrollQuizToMolTops(offset = 8) {
  const img = document.querySelector(
    "#molecule-grid .mol-img, #molecule-grid .mol-img-fallback"
  );
  scrollToElementWithOffset(img || document.getElementById("molecule-grid"), offset);
}

function scrollFgHighlightDetailsIntoView() {
  const details = document.getElementById("fg-highlight-details");
  if (!details) return;
  const target = details.querySelector("summary") || details;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollToElementWithOffset(target, 8);
    });
  });
}

function ensureResolutionInView() {
  scrollQuizToMolTops(8);
}

function toggleFgHighlightDetails() {
  const details = document.getElementById("fg-highlight-details");
  if (!details) return;
  details.open = !details.open;
  syncDetailsKeyHint(details);
  updateQuizTopHintsEl();
  if (details.open) {
    scrollFgHighlightDetailsIntoView();
  }
}

function scrollPeaPanelIntoView() {
  const details = document.getElementById("pea-panel-details");
  if (!details) return;
  const target = details.querySelector("summary") || details;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollToElementWithOffset(target, 8);
    });
  });
}

function togglePeaPanelDetails() {
  const details = document.getElementById("pea-panel-details");
  if (!details) return;
  details.open = !details.open;
  syncDetailsKeyHint(details);
  updateQuizTopHintsEl();
  if (details.open) {
    scrollPeaPanelIntoView();
  }
}

function renderCurrentSet() {
  const setData = getCurrentSetData();
  if (!setData) return;

  const gtIdx = setData.ground_truth_ooo_idx;
  const juryIdx = isPoolSpeedrunMode() ? null : state.juryAnswers[state.currentIdx];
  const resolved = !isPoolSpeedrunMode() && juryIdx != null;
  state.resolved = resolved;

  const grid = document.getElementById("molecule-grid");
  const quizBody = document.getElementById("quiz-body");
  grid.innerHTML = "";
  quizBody?.classList.toggle("resolved", resolved);

  for (let i = 0; i < setData.molecules.length; i++) {
    const card = buildMoleculeCard(setData.molecules[i], i, setData, {
      showProperties: state.config.show_properties,
      showIupac: state.config.show_iupac,
      interactive: !resolved,
      juryIdx,
      gtIdx,
      modelPredIdx: setData._modelPredIdx,
      resolved,
    });
    if (!resolved) card.addEventListener("click", () => onMoleculeClick(i));
    grid.appendChild(card);
  }

  const resolution = document.getElementById("resolution");
  const btnNext = document.getElementById("btn-next");
  const btnPrev = document.getElementById("btn-prev");

  if (isPoolSpeedrunMode()) {
    const question = document.querySelector("#screen-quiz .question");
    if (question) {
      question.textContent = "Welches Molekül passt nicht? (1–4, schnell!)";
    }
    resolution?.classList.add("hidden");
    btnNext?.classList.add("hidden");
    btnPrev?.classList.add("hidden");
    closeGlossary();
    clearResolutionFgPanels();
    document.getElementById("fg-model-perspective")?.classList.add("hidden");
    document.getElementById("pea-container").innerHTML = "";
    setSpeedrunFeedback("");
    updateProgress();
    updateQuizChrome();
    return;
  }

  btnPrev?.classList.remove("hidden");
  const question = document.querySelector("#screen-quiz .question");
  if (question) question.textContent = "Welches Molekül passt nicht dazu?";

  if (resolved) {
    resolution.classList.remove("hidden");
    btnNext.classList.remove("hidden");

    renderFgHighlight(setData);
    renderModelPerspective(setData);
    renderFgSummary(setData);

    const fgDetails = document.getElementById("fg-highlight-details");
    if (fgDetails) fgDetails.open = false;
    const peaDetails = document.getElementById("pea-panel-details");
    if (peaDetails) peaDetails.open = false;

    renderPeaHeatmap(
      document.getElementById("pea-container"),
      setData.pea_matrix_mean,
      {
        gtIdx,
        setIdx: setData.set_idx,
        wrongPredCols: setData._wrongPredCols,
      }
    );

    requestAnimationFrame(() => {
      ensureResolutionInView();
    });
  } else {
    resolution.classList.add("hidden");
    btnNext.classList.add("hidden");
    clearResolutionFgPanels();
    const perspectiveEl = document.getElementById("fg-model-perspective");
    if (perspectiveEl) {
      perspectiveEl.innerHTML = "";
      perspectiveEl.classList.add("hidden");
    }
    document.getElementById("pea-container").innerHTML = "";
    closeGlossary();
  }

  btnPrev.disabled = state.currentIdx === 0;
  updateProgress();
  updateQuizChrome();
}

async function advancePoolSpeedrunSet() {
  if (!isPoolSpeedrunMode() || state.speedrunEnded || state.speedrunTimeLeftMs <= 0) return;
  let nextIdx = state.currentIdx + 1;
  if (nextIdx >= state.poolEntries.length) nextIdx = 0;
  try {
    let found = await findNextSpeedrunPoolIndex(nextIdx);
    if (found >= state.poolEntries.length) {
      found = await findNextSpeedrunPoolIndex(0);
    }
    state.currentIdx = found < state.poolEntries.length ? found : nextIdx;
    await ensurePoolSetAt(state.currentIdx);
    renderCurrentSet();
    playQuizSetEnter();
  } catch (err) {
    console.error(err);
    endPoolSpeedrun();
  }
}

function onSpeedrunPick(molIdx) {
  if (state.speedrunPickBusy || state.speedrunEnded || state.speedrunTimeLeftMs <= 0) return;
  const setData = getCurrentSetData();
  if (!setData) return;

  state.speedrunPickBusy = true;
  const correct = isSpeedrunPickCorrect(setData, molIdx);
  if (correct) state.speedrunScore++;

  const quizBody = document.getElementById("quiz-body");
  const grid = document.getElementById("molecule-grid");
  quizBody?.classList.remove("speedrun-flash-ok", "speedrun-flash-bad");
  grid?.querySelectorAll(".mol").forEach((card, i) => {
    card.classList.remove("speedrun-pick-ok", "speedrun-pick-bad");
    if (i === molIdx) card.classList.add(correct ? "speedrun-pick-ok" : "speedrun-pick-bad");
    if (!correct && i === setData.ground_truth_ooo_idx) {
      card.classList.add("speedrun-pick-ok");
    }
  });
  quizBody?.classList.add(correct ? "speedrun-flash-ok" : "speedrun-flash-bad");
  setSpeedrunFeedback(correct ? "" : buildSpeedrunWrongFeedback(setData, molIdx));
  updateSpeedrunScoreLive();

  const delay = correct ? SPEEDRUN_PICK_ADVANCE_MS : SPEEDRUN_PICK_ADVANCE_WRONG_MS;
  window.setTimeout(async () => {
    quizBody?.classList.remove("speedrun-flash-ok", "speedrun-flash-bad");
    setSpeedrunFeedback("");
    state.speedrunPickBusy = false;
    if (!state.speedrunEnded && state.speedrunTimeLeftMs > 0) {
      await advancePoolSpeedrunSet();
    }
  }, delay);
}

function endPoolSpeedrun() {
  if (state.speedrunEnded) return;
  state.speedrunEnded = true;
  stopSpeedrunTimer();
  closeGlossary();
  const final = document.getElementById("speedrun-final-score");
  if (final) {
    final.textContent = `Du hast ${state.speedrunScore} Ausreißer in 3 Minuten richtig erkannt.`;
  }
  showScreen("speedrunOutro");
  placeThemeButton("speedrunOutro");
}

function onMoleculeClick(molIdx) {
  if (state.quizTransitionLock) return;
  if (isPoolSpeedrunMode()) {
    onSpeedrunPick(molIdx);
    return;
  }
  if (state.resolved) return;
  state.juryAnswers[state.currentIdx] = molIdx;
  document.getElementById("quiz-body")?.classList.add("is-revealing");
  renderCurrentSet();
  window.setTimeout(() => {
    document.getElementById("quiz-body")?.classList.remove("is-revealing");
  }, 400);
}

async function goNext() {
  if (state.poolLoading || state.quizTransitionLock) return;
  if (isPoolSpeedrunMode()) return;

  if (state.mode === "endless") {
    try {
      if (state.poolShuffleOn) {
        await jumpToPoolIndex(nextPoolPermutationIndex());
      } else {
        const total = state.poolEntries.length;
        if (state.currentIdx < total - 1) {
          state.currentIdx++;
        } else {
          state.currentIdx = 0;
          state.juryAnswers = new Array(total).fill(null);
        }
        syncPoolIndexChrome();
        await runQuizSetTransition(async () => {
          await ensurePoolSetAt(state.currentIdx);
          renderCurrentSet();
          window.scrollTo(0, 0);
        });
      }
    } catch (err) {
      console.error(err);
      showIntroLoadError(`Set konnte nicht geladen werden: ${err.message}`);
    }
    return;
  }

  if (state.currentIdx < state.sets.length - 1) {
    await runQuizSetTransition(() => {
      state.currentIdx++;
      renderCurrentSet();
      window.scrollTo(0, 0);
    });
  } else {
    showOutro();
  }
}

async function goPrev() {
  if (state.poolLoading || state.quizTransitionLock) return;
  if (isPoolSpeedrunMode()) return;
  if (!state.poolShuffleOn && state.currentIdx === 0) return;

  if (state.mode === "endless") {
    try {
      if (state.poolShuffleOn) {
        await jumpToPoolIndex(prevPoolPermutationIndex());
      } else {
        state.currentIdx--;
        syncPoolIndexChrome();
        await runQuizSetTransition(async () => {
          await ensurePoolSetAt(state.currentIdx);
          renderCurrentSet();
          window.scrollTo(0, 0);
        });
      }
    } catch (err) {
      console.error(err);
      showIntroLoadError(`Set konnte nicht geladen werden: ${err.message}`);
    }
    return;
  }

  await runQuizSetTransition(() => {
    state.currentIdx--;
    renderCurrentSet();
    window.scrollTo(0, 0);
  });
}

function showOutro() {
  if (isPoolMode()) return;
  const total = state.curatedSets.length;
  let juryCorrect = 0;
  state.curatedSets.forEach((set, i) => {
    if (state.juryAnswers[i] === set.ground_truth_ooo_idx) juryCorrect++;
  });
  document.getElementById("outro-score").textContent =
    `Du lagst ${juryCorrect} von ${total} mal richtig.`;
  closeGlossary();
  showScreen("outro");
}

function setStartButtonState(loading, errorMsg = null) {
  const btn = document.getElementById("btn-start");
  if (!btn) return;

  if (loading) {
    btn.disabled = true;
    btn.textContent = "Lade Quiz …";
    btn.setAttribute("aria-busy", "true");
    return;
  }

  btn.removeAttribute("aria-busy");
  setButtonKeyHint(btn, "Los geht's", "1");
  btn.disabled = Boolean(errorMsg) || !state.curatedSets.length;
}

function showIntroLoadError(message) {
  state.loadError = message;
  setStartButtonState(false, message);
  let el = document.getElementById("intro-load-error");
  if (!el) {
    el = document.createElement("p");
    el.id = "intro-load-error";
    el.className = "intro-text error-msg";
    document.querySelector("#screen-intro .intro-body")?.appendChild(el);
  }
  el.textContent = message;
}

function bindQuizControls() {
  const btnStart = document.getElementById("btn-start");
  btnStart?.addEventListener("click", onStartClick);
  document.getElementById("btn-next")?.addEventListener("click", goNext);
  document.getElementById("btn-prev")?.addEventListener("click", goPrev);
  document.getElementById("btn-home")?.addEventListener("click", goHome);
  document.getElementById("btn-outro-home")?.addEventListener("click", goHome);
  document.getElementById("btn-restart")?.addEventListener("click", onStartClick);
  document.getElementById("btn-endless")?.addEventListener("click", onEndlessClick);
  document.getElementById("btn-intro-endless")?.addEventListener("click", onEndlessClick);
  document.getElementById("btn-intro-pool-speedrun")?.addEventListener("click", () => {
    startPoolSpeedrun().catch((err) => console.error(err));
  });
  document.getElementById("btn-speedrun-retry")?.addEventListener("click", () => {
    startPoolSpeedrun().catch((err) => console.error(err));
  });
  document.getElementById("btn-speedrun-to-pool")?.addEventListener("click", onEndlessClick);
  document.getElementById("btn-speedrun-outro-home")?.addEventListener("click", goHome);
  document.getElementById("pool-shuffle-toggle")?.addEventListener("click", togglePoolShuffle);
  const poolJumpInput = document.getElementById("pool-jump-input");
  poolJumpInput?.addEventListener("change", onPoolJumpFromInput);
  poolJumpInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onPoolJumpFromInput();
    }
  });
  document.getElementById("btn-more-info")?.addEventListener("click", () => showInfoScreen("outro"));
  document.getElementById("btn-intro-more-info")?.addEventListener("click", () => showInfoScreen("intro"));
  document.getElementById("btn-info-back")?.addEventListener("click", () => {
    if (state.infoReturn === "intro") goHome();
    else if (state.infoReturn === "outro") showScreen("outro");
    else showScreen("intro");
  });
  document.getElementById("btn-back-quiz")?.addEventListener("click", async () => {
    setStartButtonState(true);
    try {
      clearAllSetsCache();
      state.config = await loadConfig();
      updateLayoutFlags(state.config);
      state.curatedSets = await loadConfiguredSets(state.config);
      state.sets = state.curatedSets;
      state.loadError = null;
      document.getElementById("intro-load-error")?.remove();
    } catch (err) {
      showIntroLoadError(`Laden fehlgeschlagen: ${err.message}`);
    } finally {
      setStartButtonState(false, state.loadError);
    }
    showScreen("intro");
  });
}

function onStartClick() {
  if (!state.appReady) {
    showIntroLoadError("Quiz wird noch geladen — bitte einen Moment warten.");
    return;
  }
  if (state.loadError || !state.curatedSets.length) {
    showIntroLoadError(state.loadError || "Keine Sets geladen — bitte Seite neu laden.");
    return;
  }
  startQuiz();
}

function onEndlessClick() {
  if (!state.appReady) {
    showIntroLoadError("Quiz wird noch geladen — bitte einen Moment warten.");
    return;
  }
  if (state.loadError || !state.config?.sets?.length) {
    showIntroLoadError(state.loadError || "Keine Sets geladen — bitte Seite neu laden.");
    return;
  }
  startEndlessMode().catch((err) => {
    console.error(err);
    showIntroLoadError(`Weitere Sets konnten nicht geladen werden: ${err.message}`);
  });
}

function restoreIntroLinkBtn(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  const base = btn.dataset.label;
  if (!base) return;
  const key = (btn.dataset.keyHint || "").replace(/^\(|\)$/g, "");
  if (loading) {
    btn.textContent = "Lade …";
    return;
  }
  setButtonKeyHint(btn, base, key || null);
}

function setPoolButtonsLoading(loading) {
  restoreIntroLinkBtn(document.getElementById("btn-intro-endless"), loading);
  restoreIntroLinkBtn(document.getElementById("btn-intro-pool-speedrun"), loading);
  const endlessOutro = document.getElementById("btn-endless");
  if (endlessOutro) {
    endlessOutro.disabled = loading;
    endlessOutro.textContent = loading ? "Lade …" : POOL_BTN_LABEL;
  }
}

function resetSpeedrunState() {
  stopSpeedrunTimer();
  state.speedrunScore = 0;
  state.speedrunEndsAt = null;
  state.speedrunTimeLeftMs = 0;
  state.speedrunEnded = false;
  state.speedrunPickBusy = false;
}

function goHome() {
  resetSpeedrunState();
  state.mode = null;
  state.quizTransitionLock = false;
  closeGlossary();
  closeFgTutorial();
  showScreen("intro");
  updateQuizChrome();
  setPoolButtonsLoading(false);
  if (state.curatedSets.length) {
    state.loadError = null;
    document.getElementById("intro-load-error")?.remove();
    setStartButtonState(false, null);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function startQuiz() {
  resetSpeedrunState();
  state.mode = "curated";
  state.sets = state.curatedSets;
  state.currentIdx = 0;
  state.juryAnswers = new Array(state.sets.length).fill(null);
  showScreen("quiz");
  updateQuizChrome();
  renderCurrentSet();
  playQuizSetEnter();
}

async function startPoolSpeedrun() {
  if (!state.appReady) {
    showIntroLoadError("Quiz wird noch geladen — bitte einen Moment warten.");
    return;
  }
  if (state.loadError || !state.config?.sets?.length) {
    showIntroLoadError(state.loadError || "Keine Sets geladen — bitte Seite neu laden.");
    return;
  }
  setPoolButtonsLoading(true);
  try {
    const manifest = await loadPoolManifest();
    const curated = state.config.sets.map((e) => `${e.strategy}_${e.set_idx}`);
    state.poolEntries = shuffleArray(buildPoolEntries(manifest, curated));
    if (!state.poolEntries.length) {
      throw new Error("Keine zusätzlichen Sets im Pool.");
    }
    state.poolCache = new Map();
    state.poolSetData = null;
    state.mode = "pool-speedrun";
    state.sets = [];
    resetSpeedrunState();
    state.speedrunScore = 0;
    let startIdx = await findNextSpeedrunPoolIndex(0);
    if (startIdx >= state.poolEntries.length) startIdx = 0;
    state.currentIdx = startIdx;
    await ensurePoolSetAt(state.currentIdx);
    showScreen("quiz");
    updateQuizChrome();
    startPoolSpeedrunCountdown();
    renderCurrentSet();
    playQuizSetEnter();
  } finally {
    setPoolButtonsLoading(false);
  }
}

async function startEndlessMode() {
  resetSpeedrunState();
  setPoolButtonsLoading(true);
  try {
    const manifest = await loadPoolManifest();
    const curated = state.config.sets.map((e) => `${e.strategy}_${e.set_idx}`);
    state.poolEntries = buildPoolEntries(manifest, curated);
    if (!state.poolEntries.length) {
      throw new Error("Keine zusätzlichen Sets im Pool.");
    }
    state.poolCache = new Map();
    state.poolSetData = null;
    state.mode = "endless";
    state.poolShuffleOn = false;
    state.poolOrder = [];
    state.poolOrderPos = 0;
    state.currentIdx = 0;
    state.juryAnswers = new Array(state.poolEntries.length).fill(null);
    state.sets = [];
    await ensurePoolSetAt(0);
    showScreen("quiz");
    updateQuizChrome();
    renderCurrentSet();
    playQuizSetEnter();
  } finally {
    setPoolButtonsLoading(false);
  }
}

async function showInfoScreen(returnTo = "outro") {
  state.infoReturn = returnTo;
  showScreen("info");
  const el = document.getElementById("info-content");
  try {
    const resp = await fetch("./WISSENSCHAFTLICHE_EINORDNUNG.md", { cache: "no-store" });
    if (!resp.ok) throw new Error("Datei nicht gefunden");
    el.innerHTML = simpleMdToHtml(await resp.text());
  } catch (err) {
    el.innerHTML = `<p class="error-msg">Info konnte nicht geladen werden: ${escapeHtml(err.message)}</p>`;
  }
}

function initGlossary() {
  document.getElementById("btn-fg-glossary-close")?.addEventListener("click", closeGlossary);
  GLOSSARY_BACKDROP?.addEventListener("click", (e) => {
    if (e.target === GLOSSARY_BACKDROP) closeGlossary();
  });
}

function isTypingTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function clickById(id) {
  document.getElementById(id)?.click();
}

function initKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (isTypingTarget(e.target)) return;

    if (e.key === "Escape" && GLOSSARY_BACKDROP && !GLOSSARY_BACKDROP.classList.contains("hidden")) {
      e.preventDefault();
      closeGlossary();
      return;
    }

    const tutorialBackdrop = document.getElementById("fg-tutorial-backdrop");
    if (tutorialBackdrop && !tutorialBackdrop.classList.contains("hidden")) return;

    if (isCuratorMode()) {
      const curatorActive =
        SCREENS.curator?.classList.contains("active") ||
        document.getElementById("screen-perspective-curator")?.classList.contains("active") ||
        document.getElementById("screen-fg-curator")?.classList.contains("active");
      if (curatorActive) return;
    }

    if (SCREENS.quiz?.classList.contains("active")) {
      if (e.key === "f" || e.key === "F") {
        if (state.resolved) {
          e.preventDefault();
          toggleFgHighlightDetails();
        }
        return;
      }
      if ((e.key === "r" || e.key === "R") && isEndlessPoolMode()) {
        e.preventDefault();
        togglePoolShuffle();
        return;
      }
      if (e.key === "p" || e.key === "P") {
        if (state.resolved) {
          e.preventDefault();
          togglePeaPanelDetails();
        }
        return;
      }
      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        goHome();
        return;
      }
      if (isPoolSpeedrunMode()) {
        if (e.key >= "1" && e.key <= "4") {
          e.preventDefault();
          onMoleculeClick(parseInt(e.key, 10) - 1);
        }
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (state.resolved) {
          goNext();
        } else if (isEndlessPoolMode()) {
          navigatePoolSet(1);
        }
        return;
      }
      if ((e.key === "Enter" || e.key === " ") && state.resolved) {
        e.preventDefault();
        goNext();
        return;
      }
      if (!state.resolved && e.key >= "1" && e.key <= "4") {
        e.preventDefault();
        onMoleculeClick(parseInt(e.key, 10) - 1);
      }
      return;
    }

    if (SCREENS.intro?.classList.contains("active")) {
      if (e.key === "1" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        clickById("btn-start");
      } else if (e.key === "2") {
        e.preventDefault();
        clickById("btn-intro-fg-tutorial");
      } else if (e.key === "3") {
        e.preventDefault();
        clickById("btn-intro-endless");
      } else if (e.key === "4") {
        e.preventDefault();
        document.getElementById("btn-intro-pool-speedrun")?.click();
      } else if (e.key === "5") {
        e.preventDefault();
        clickById("btn-intro-more-info");
      }
      return;
    }

    if (SCREENS.speedrunOutro?.classList.contains("active")) {
      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        goHome();
      }
      return;
    }

    if (SCREENS.outro?.classList.contains("active")) {
      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        goHome();
        return;
      }
      if (e.key === "1" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        clickById("btn-restart");
      } else if (e.key === "2") {
        e.preventDefault();
        clickById("btn-endless");
      } else if (e.key === "3") {
        e.preventDefault();
        clickById("btn-more-info");
      }
      return;
    }

    if (SCREENS.info?.classList.contains("active")) {
      if (e.key === "Escape" || e.key === "b" || e.key === "B") {
        e.preventDefault();
        if (state.infoReturn === "intro") goHome();
        else showScreen(state.infoReturn === "outro" ? "outro" : "intro");
      }
    }
  });
}

function initCuratorEntry() {
  const intro = document.querySelector("#screen-intro h1");
  if (!intro) return;
  let timer = null;
  const start = () => {
    timer = setTimeout(() => {
      showCuratorScreen().catch((err) => {
        console.error("Kurator konnte nicht geladen werden:", err);
      });
    }, 800);
  };
  const stop = () => clearTimeout(timer);
  intro.addEventListener("mousedown", start);
  intro.addEventListener("mouseup", stop);
  intro.addEventListener("mouseleave", stop);
  intro.addEventListener("touchstart", start, { passive: true });
  intro.addEventListener("touchend", stop);
}

const THEME_KEY = "jufo_theme";

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function updateThemeButton(theme, followsSystem) {
  const btn = document.getElementById("btn-theme");
  if (!btn) return;
  const compact = isCompactKeyHints();
  const suffix = followsSystem && !compact ? " · SYS" : "";
  if (theme === "dark") {
    const label = compact ? "☀" : `☀ HELL${suffix}`;
    btn.innerHTML = escapeHtml(label);
    btn.setAttribute("aria-label", followsSystem ? "Hellmodus (folgt System)" : "Hellmodus");
  } else {
    const label = compact ? "☾" : `☾ DUNKEL${suffix}`;
    btn.innerHTML = escapeHtml(label);
    btn.setAttribute("aria-label", followsSystem ? "Dunkelmodus (folgt System)" : "Dunkelmodus");
  }
  btn.title = followsSystem
    ? "Folgt der Systemeinstellung — Klick setzt manuelle Wahl"
    : "Manuelle Theme-Wahl";
  updateQuizTopHintsEl();
}

function applyTheme(theme, persist = false) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  if (persist) {
    localStorage.setItem(THEME_KEY, theme);
  }
  updateThemeButton(theme, !localStorage.getItem(THEME_KEY));
}

function updateLayoutFlags(config) {
  const compact = !config?.show_properties && !config?.show_iupac;
  document.body.classList.toggle("compact-mol", compact);
}

function initTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const followsSystem = stored !== "light" && stored !== "dark";
  const theme = followsSystem ? getSystemTheme() : stored;
  applyTheme(theme, false);

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!localStorage.getItem(THEME_KEY)) {
      applyTheme(e.matches ? "dark" : "light", false);
    }
  });

  window.matchMedia("(max-width: 767px)").addEventListener("change", () => {
    const follows = localStorage.getItem(THEME_KEY) !== "light" && localStorage.getItem(THEME_KEY) !== "dark";
    const current =
      document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    updateThemeButton(current, follows);
  });

  document.getElementById("btn-theme")?.addEventListener("click", () => {
    const next =
      document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next, true);
  });
}

async function init() {
  initTheme();
  bindDetailsKeyHintSync();
  initKeyHintsLayout(refreshKeyHintsLayout);
  refreshKeyHintsLayout();
  initKeyboard();
  initGlossary();
  initFgTutorial();
  bindQuizControls();
  setStartButtonState(true);

  try {
    clearAllSetsCache();
    state.config = await loadConfig();
    updateLayoutFlags(state.config);
    state.curatedSets = await loadConfiguredSets(state.config);

    if (!state.curatedSets.length) {
      const resp = await fetch("./config.json", { cache: "no-store" });
      if (resp.ok) {
        const fallbackConfig = await resp.json();
        const fallbackSets = await loadConfiguredSets(fallbackConfig);
        if (fallbackSets.length) {
          state.config = fallbackConfig;
          updateLayoutFlags(state.config);
          state.curatedSets = fallbackSets;
        }
      }
    }

    state.sets = state.curatedSets;

    if (!state.curatedSets.length) {
      showIntroLoadError("Keine Quiz-Sets geladen — bitte Seite neu laden.");
    } else {
      state.loadError = null;
      document.getElementById("intro-load-error")?.remove();
    }
  } catch (err) {
    showIntroLoadError(`Laden fehlgeschlagen: ${err.message}`);
    return;
  } finally {
    state.appReady = true;
    setStartButtonState(false, state.loadError);
  }

  window.addEventListener("jufo-config-updated", async (e) => {
    state.config = e.detail;
    updateLayoutFlags(state.config);
    state.curatedSets = await loadConfiguredSets(state.config);
    if (state.mode === "curated") state.sets = state.curatedSets;
    setStartButtonState(false, state.curatedSets.length ? null : "Keine Sets geladen");
  });

}

init().catch((err) => {
  console.error(err);
  document.getElementById("app").innerHTML =
    `<p class="error-msg">Start fehlgeschlagen: ${escapeHtml(err.message)}</p>`;
});

export { showScreen, startQuiz, state };
