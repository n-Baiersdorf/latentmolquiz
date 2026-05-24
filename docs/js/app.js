/**
 * Presentation mode — minimal quiz flow.
 */

import {
  loadConfig,
  loadConfiguredSets,
  loadAllInferenceSets,
  clearAllSetsCache,
  moleculeImagePath,
  formatProperty,
  isCuratorMode,
} from "./data-loader.js";
import { renderPeaHeatmap } from "./pea-heatmap.js";
import { showCuratorScreen, ensureCuratorReady } from "./curator.js";

const SCREENS = {
  intro: document.getElementById("screen-intro"),
  quiz: document.getElementById("screen-quiz"),
  outro: document.getElementById("screen-outro"),
  info: document.getElementById("screen-info"),
  curator: document.getElementById("screen-curator"),
};

const GLOSSARY_BACKDROP = document.getElementById("fg-glossary-backdrop");
const GLOSSARY_BODY = document.getElementById("fg-glossary-body");

const state = {
  config: null,
  curatedSets: [],
  sets: [],
  currentIdx: 0,
  juryAnswers: [],
  resolved: false,
  mode: "curated",
  currentGlossary: null,
  infoReturn: "outro",
  appReady: false,
  loadError: null,
};

function showScreen(name) {
  Object.entries(SCREENS).forEach(([key, el]) => {
    el?.classList.toggle("active", key === name);
  });
}

function updateProgress() {
  const total = state.sets.length;
  const current = state.currentIdx + 1;
  const suffix = state.mode === "endless" ? " · Endlos" : "";
  document.getElementById("progress-label").textContent = `${current} / ${total}${suffix}`;
}

function setKey(s) {
  return `${s.strategy}_${s.set_idx}`;
}

function hasFgData(setData) {
  return setData.molecules.some((m) => m.fg_labels_de?.length || m.fg_primary_de);
}

function fgPrimaryDe(mol) {
  return mol?.fg_primary_de || null;
}

function fgChips(labels, glossary = null) {
  return labels
    .map((l) => {
      const text = escapeHtml(l);
      if (glossary?.[l]) {
        return `<button type="button" class="fg-chip fg-chip-btn" data-fg="${text}" aria-label="${text} — Erklärung">${text}</button>`;
      }
      return `<span class="fg-chip">${text}</span>`;
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
  const gtMol = setData.molecules[gtIdx];
  const gtNum = gtIdx + 1;
  const others = formatOtherMolNums(setData, gtIdx);

  if (!hasFgData(setData)) {
    return {
      gtIdx,
      bodyHtml: `${others} bilden die chemische Gruppe — ${molNum(gtNum)} weicht davon ab.`,
      subHtml: null,
    };
  }

  const shared = fg?.shared_fgs_de || [];
  const extra = fg?.gt_extra_fgs_de || [];
  const gtLacks = fg?.gt_lacks_fgs_de || [];
  const gtFgDe = fg?.gt_fg_de || fgPrimaryDe(gtMol);
  const gtLabels = fgLabelsDe(gtMol);
  const glossary = fg?.glossary || {};

  // Fall 1: Die anderen teilen X, Ausreißer fehlt X
  if (gtLacks.length) {
    const lacksChips = fgChips(gtLacks, glossary);
    let subHtml = null;
    const instead = gtLabels.length ? gtLabels : gtFgDe ? [gtFgDe] : [];
    if (instead.length) {
      subHtml = `Stattdessen: ${fgChips(instead, glossary)}`;
    }
    return {
      gtIdx,
      bodyHtml: `${others} haben alle ${lacksChips} — ${molNum(gtNum)} hat das nicht.`,
      subHtml,
    };
  }

  // Fall 2: Alle vier teilen X, Ausreißer hat zusätzlich Y
  if (shared.length && extra.length) {
    return {
      gtIdx,
      bodyHtml: `Alle vier haben ${fgChips(shared, glossary)} — aber ${molNum(gtNum)} hat zusätzlich ${fgChips(extra, glossary)}.`,
      subHtml: null,
    };
  }

  // Fall 3: Ausreißer hat X exklusiv
  if (extra.length) {
    return {
      gtIdx,
      bodyHtml: `Nur ${molNum(gtNum)} hat ${fgChips(extra, glossary)} — die anderen nicht.`,
      subHtml: null,
    };
  }

  // Fallback: Primärgruppe unterscheidet, auch wenn die Gruppe woanders als Neben-Label vorkommt
  const otherPrim = fg?.other_primaries_de || [];
  const othersSharePrimary = setData.molecules.some(
    (mol, i) => i !== gtIdx && mol.fg_labels_de?.includes(gtFgDe)
  );
  if (gtFgDe && otherPrim.length) {
    const lead = othersSharePrimary ? "Als Primärgruppe hat" : "Hat";
    return {
      gtIdx,
      bodyHtml: `${molNum(gtNum)} ${lead} ${fgChips([gtFgDe], glossary)} — abweichend von ${fgChips(otherPrim, glossary)}.`,
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

function buildModelPerspectiveHtml(setData) {
  if (!setData._modelAltCorrect || !hasFgData(setData)) return null;

  const fg = setData._fgAnalysis;
  const gtIdx = setData.ground_truth_ooo_idx;
  const modelIdx = setData._modelPredIdx;
  if (modelIdx == null || modelIdx === gtIdx) return null;

  const glossary = fg?.glossary || {};
  const modelNum = modelIdx + 1;
  const gtNum = gtIdx + 1;
  const exclusive = fg?.model_exclusive_fgs_de || [];
  const lacks = fg?.model_lacks_fgs_de || [];
  const noN = fg?.model_without_n_fg;
  const unanimous = setData._category === "confident_wrong";

  let intro = unanimous
    ? `Alle Seeds wählen einheitlich ${molNum(modelNum)} — nicht die definierte Ground Truth (${molNum(gtNum)}). `
    : `Das Modell tendiert zu ${molNum(modelNum)} statt ${molNum(gtNum)}. `;

  let reason = "";
  if (noN) {
    reason = `nur ${molNum(modelNum)} hat keine stickstoffhaltige funktionelle Gruppe`;
  } else if (exclusive.length) {
    reason = `nur ${molNum(modelNum)} hat ${fgChips(exclusive, glossary)}`;
  } else if (lacks.length) {
    reason = `nur ${molNum(modelNum)} hat kein ${fgChips(lacks, glossary)} — die anderen schon`;
  }

  const gtLacks = fg?.gt_lacks_fgs_de || [];
  const gtExtra = fg?.gt_extra_fgs_de || [];
  let gtPart = "";
  if (gtLacks.length) {
    const others = formatOtherMolNums(setData, gtIdx);
    gtPart = `Die definierte Ground Truth sieht ${molNum(gtNum)} als Ausreißer, weil ${others} ${fgChips(gtLacks, glossary)} teilen — ${molNum(gtNum)} nicht`;
  } else if (gtExtra.length) {
    gtPart = `Die definierte Ground Truth sieht ${molNum(gtNum)} wegen ${fgChips(gtExtra, glossary)} als Ausreißer`;
  } else {
    gtPart = "Die definierte Ground Truth fasst die Gruppe anders";
  }

  if (!reason) return null;
  return `${intro}Chemisch nachvollziehbar: ${reason}. ${gtPart} — beides ist verteidbar.`;
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

function formatFgCell(labels, uniqueSet, isGtRow, altPlausibleSet, isModelAltRow) {
  if (!labels.length) return "—";
  return labels
    .map((fg) => {
      if (isGtRow && uniqueSet.has(fg)) {
        return `<span class="fg-unique">${escapeHtml(fg)}</span>`;
      }
      if (isModelAltRow && altPlausibleSet?.has(fg)) {
        return `<span class="fg-alt-plausible">${escapeHtml(fg)}</span>`;
      }
      return escapeHtml(fg);
    })
    .join(", ");
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
  const entries = Object.entries(glossary);
  if (!entries.length) return;

  GLOSSARY_BODY.innerHTML = entries
    .map(
      ([name, explain]) =>
        `<div class="fg-glossary-item"><strong>${escapeHtml(name)}</strong><p>${escapeHtml(explain)}</p></div>`
    )
    .join("");

  GLOSSARY_BACKDROP.classList.remove("hidden");
  GLOSSARY_BACKDROP.setAttribute("aria-hidden", "false");
  document.getElementById("btn-fg-glossary-close")?.focus();
}

function openGlossaryTerm(glossary, term) {
  if (!glossary?.[term]) return;
  openGlossary({ [term]: glossary[term] });
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

function renderFgHighlight(setData) {
  const el = document.getElementById("fg-highlight");
  if (!el) return;
  const { gtIdx, bodyHtml, subHtml } = buildHighlightContent(setData);
  const glossary = setData._fgAnalysis?.glossary || null;
  const perspectiveHtml = buildModelPerspectiveHtml(setData);

  el.innerHTML = `
    <p class="fg-highlight-title">★ Ausreißer: Molekül #${gtIdx + 1}</p>
    <p class="fg-highlight-body">${bodyHtml}</p>
    ${subHtml ? `<p class="fg-highlight-sub">${subHtml}</p>` : ""}
    ${perspectiveHtml ? `
    <div class="fg-highlight-perspective">
      <p class="fg-perspective-title">↗ Sicht des Modells</p>
      <p class="fg-perspective-body">${perspectiveHtml}</p>
    </div>` : ""}`;

  bindFgChipClicks(el, glossary);
}

function renderFgSummary(setData) {
  const el = document.getElementById("fg-summary");
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

  let html = `<div class="fg-table-head">
    <p class="fg-section-title">Funktionelle Gruppen</p>
    <button type="button" id="btn-fg-glossary" class="info-btn">ⓘ Begriffe dieses Sets</button>
  </div>`;

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
          setData._modelAltCorrect && i === modelIdx
        )}</td>
      </tr>`;
    })
    .join("");

  html += `
    <table class="mol-compare-table">
      <tbody>${rows}</tbody>
    </table>`;

  el.innerHTML = html;

  document.getElementById("btn-fg-glossary")?.addEventListener("click", () => {
    openGlossary(state.currentGlossary);
  });
}

function renderCurrentSet() {
  const setData = state.sets[state.currentIdx];
  if (!setData) return;

  const juryIdx = state.juryAnswers[state.currentIdx];
  const gtIdx = setData.ground_truth_ooo_idx;
  const resolved = juryIdx != null;
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

  if (resolved) {
    resolution.classList.remove("hidden");
    btnNext.classList.remove("hidden");

    renderFgHighlight(setData);
    renderFgSummary(setData);

    const details = document.getElementById("resolution-details");
    if (details) details.open = false;

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
      document.getElementById("fg-highlight")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  } else {
    resolution.classList.add("hidden");
    btnNext.classList.add("hidden");
    document.getElementById("fg-highlight").innerHTML = "";
    document.getElementById("fg-summary").innerHTML = "";
    document.getElementById("pea-container").innerHTML = "";
    closeGlossary();
  }

  btnPrev.disabled = state.currentIdx === 0;
  updateProgress();
}

function onMoleculeClick(molIdx) {
  if (state.resolved) return;
  state.juryAnswers[state.currentIdx] = molIdx;
  renderCurrentSet();
}

function goNext() {
  if (state.currentIdx < state.sets.length - 1) {
    state.currentIdx++;
    renderCurrentSet();
  } else if (state.mode === "endless") {
    state.currentIdx = 0;
    state.juryAnswers = new Array(state.sets.length).fill(null);
    renderCurrentSet();
  } else {
    showOutro();
  }
}

function goPrev() {
  if (state.currentIdx > 0) {
    state.currentIdx--;
    renderCurrentSet();
  }
}

function showOutro() {
  if (state.mode === "endless") return;
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
  btn.textContent = "Los geht's";
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
  document.getElementById("btn-restart")?.addEventListener("click", onStartClick);
  document.getElementById("btn-endless")?.addEventListener("click", onEndlessClick);
  document.getElementById("btn-intro-endless")?.addEventListener("click", onEndlessClick);
  document.getElementById("btn-more-info")?.addEventListener("click", () => showInfoScreen("outro"));
  document.getElementById("btn-intro-more-info")?.addEventListener("click", () => showInfoScreen("intro"));
  document.getElementById("btn-info-back")?.addEventListener("click", () => {
    goHome();
  });
  document.getElementById("btn-back-quiz")?.addEventListener("click", async () => {
    setStartButtonState(true);
    try {
      clearAllSetsCache();
      state.config = await loadConfig();
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
  startEndlessMode();
}

function goHome() {
  showScreen("intro");
}

function startQuiz() {
  state.mode = "curated";
  state.sets = state.curatedSets;
  state.currentIdx = 0;
  state.juryAnswers = new Array(state.sets.length).fill(null);
  showScreen("quiz");
  renderCurrentSet();
}

async function startEndlessMode() {
  const curated = new Set(state.config.sets.map((e) => `${e.strategy}_${e.set_idx}`));
  const all = await loadAllInferenceSets();
  state.mode = "endless";
  state.sets = all.filter((s) => !curated.has(setKey(s)));
  state.currentIdx = 0;
  state.juryAnswers = new Array(state.sets.length).fill(null);
  showScreen("quiz");
  renderCurrentSet();
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

function initKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && GLOSSARY_BACKDROP && !GLOSSARY_BACKDROP.classList.contains("hidden")) {
      e.preventDefault();
      closeGlossary();
      return;
    }

    if (isCuratorMode() && SCREENS.curator.classList.contains("active")) return;
    if (!SCREENS.quiz.classList.contains("active")) return;

    if (e.key === "ArrowRight" && state.resolved) {
      e.preventDefault();
      goNext();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev();
    } else if (!state.resolved && e.key >= "1" && e.key <= "4") {
      e.preventDefault();
      onMoleculeClick(parseInt(e.key, 10) - 1);
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
  const suffix = followsSystem ? " · SYS" : "";
  if (theme === "dark") {
    btn.textContent = `☀ HELL${suffix}`;
    btn.setAttribute("aria-label", followsSystem ? "Hellmodus (folgt System)" : "Hellmodus");
  } else {
    btn.textContent = `☾ DUNKEL${suffix}`;
    btn.setAttribute("aria-label", followsSystem ? "Dunkelmodus (folgt System)" : "Dunkelmodus");
  }
  btn.title = followsSystem
    ? "Folgt der Systemeinstellung — Klick setzt manuelle Wahl"
    : "Manuelle Theme-Wahl";
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

  document.getElementById("btn-theme")?.addEventListener("click", () => {
    const next =
      document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next, true);
  });
}

async function init() {
  initTheme();
  initKeyboard();
  initGlossary();
  bindQuizControls();
  setStartButtonState(true);

  try {
    clearAllSetsCache();
    state.config = await loadConfig();
    state.curatedSets = await loadConfiguredSets(state.config);

    if (!state.curatedSets.length) {
      const resp = await fetch("./config.json", { cache: "no-store" });
      if (resp.ok) {
        const fallbackConfig = await resp.json();
        const fallbackSets = await loadConfiguredSets(fallbackConfig);
        if (fallbackSets.length) {
          state.config = fallbackConfig;
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
