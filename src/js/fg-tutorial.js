/**
 * FG tutorial — compact popup with 2-molecule comparison pairs.
 */

const TUTORIAL_STORAGE_KEY = "jufo_fg_tutorial_done";

const PAIRS = [
  {
    id: "p1",
    title: "Keton vs. Aldehyd",
    left: { label: "Keton", caption: "C=O in der Mitte" },
    right: { label: "Aldehyd", caption: "C=O am Kettenende" },
    note: "=O allein reicht nicht — der Kontext entscheidet.",
  },
  {
    id: "p2",
    title: "Alkohol vs. Ether",
    left: { label: "Alkohol", caption: "-OH am Kohlenstoff" },
    right: { label: "Ether", caption: "-O- zwischen zwei C-Resten" },
    note: "Alkohol: OH-Gruppe. Ether: Sauerstoff verbindet zwei Ketten.",
  },
  {
    id: "p3",
    title: "Carbonsäure vs. Ester",
    left: { label: "Carbonsäure", caption: "-COOH" },
    right: { label: "Ester", caption: "-COO- an der Kette" },
    note: "Carbonsäure: –COOH (C=O und –OH am selben C). Ester: C=O mit –O– zu einem zweiten Kohlenstoff.",
  },
  {
    id: "p4",
    title: "Primäres vs. sekundäres Amin",
    left: { label: "–NH₂", caption: "zwei H am Stickstoff" },
    right: { label: "Sekundäres Amin", caption: "-NH- (2× C-N)" },
    note: "Zähle die Bindungen am Stickstoff.",
  },
  {
    id: "p5",
    title: "Amin vs. Amid",
    left: { label: "–NH₂ / Amin", caption: "freies NH₂ oder NH" },
    right: { label: "Amid", caption: "-CONR-" },
    note: "Amid: Stickstoff direkt an C=O — kein freies Amin.",
  },
];

const STEPS = [
  {
    type: "intro",
    html: `<p class="fg-tutorial-lead">Im Quiz suchst du das Molekül, das <strong>anders</strong> ist — meist wegen einer anderen funktionellen Gruppe.</p>
<p>Kurz die wichtigsten Unterschiede (Sauerstoff- und Stickstoff-Gruppen):</p>`,
  },
  ...PAIRS.map((p) => ({ type: "pair", ...p })),
  {
    type: "outro",
    html: `<p>Das reicht fürs Quiz — nach deiner Wahl siehst du die Erklärung mit funktionellen Gruppen.</p>`,
  },
];

let backdrop = null;
let bodyEl = null;
let titleEl = null;
let stepLabel = null;
let btnPrev = null;
let btnNext = null;
let btnClose = null;
let currentStep = 0;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPair(pair) {
  return `<div class="fg-tutorial-pair" role="group" aria-label="${escapeHtml(pair.title)}">
  <div class="fg-tutorial-pair-item">
    <img src="./gallery/tutorial_${pair.id}_mol0.png" alt="${escapeHtml(pair.left.label)}" class="fg-tutorial-pair-img" loading="eager">
    <strong>${escapeHtml(pair.left.label)}</strong>
    <span class="muted">${escapeHtml(pair.left.caption)}</span>
  </div>
  <div class="fg-tutorial-pair-item">
    <img src="./gallery/tutorial_${pair.id}_mol1.png" alt="${escapeHtml(pair.right.label)}" class="fg-tutorial-pair-img" loading="eager">
    <strong>${escapeHtml(pair.right.label)}</strong>
    <span class="muted">${escapeHtml(pair.right.caption)}</span>
  </div>
</div>
<p class="fg-tutorial-note">${escapeHtml(pair.note)}</p>`;
}

function renderStep(stepIdx) {
  const step = STEPS[stepIdx];
  if (!step || !bodyEl) return;

  if (titleEl) {
    titleEl.textContent =
      step.type === "pair" ? step.title : step.type === "intro" ? "Kurz erklärt" : "Fertig";
  }

  if (step.type === "pair") {
    bodyEl.innerHTML = renderPair(step);
  } else {
    bodyEl.innerHTML = step.html || "";
  }

  if (stepLabel) stepLabel.textContent = `${stepIdx + 1} / ${STEPS.length}`;
  if (btnPrev) btnPrev.disabled = stepIdx === 0;
  if (btnNext) {
    if (stepIdx >= STEPS.length - 1) {
      btnNext.textContent = "Schließen";
    } else {
      btnNext.innerHTML = '<kbd class="key-hint" aria-hidden="true">→</kbd> Weiter';
    }
  }
}

function closeTutorial(markDone = false) {
  if (!backdrop) return;
  backdrop.classList.add("hidden");
  backdrop.setAttribute("aria-hidden", "true");
  if (markDone) localStorage.setItem(TUTORIAL_STORAGE_KEY, "1");
}

export function openFgTutorial(step = 0) {
  if (!backdrop) return;
  currentStep = Math.max(0, Math.min(step, STEPS.length - 1));
  renderStep(currentStep);
  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
  btnClose?.focus();
}

export function initFgTutorial() {
  backdrop = document.getElementById("fg-tutorial-backdrop");
  bodyEl = document.getElementById("fg-tutorial-body");
  titleEl = document.getElementById("fg-tutorial-title");
  stepLabel = document.getElementById("fg-tutorial-step");
  btnPrev = document.getElementById("btn-fg-tutorial-prev");
  btnNext = document.getElementById("btn-fg-tutorial-next");
  btnClose = document.getElementById("btn-fg-tutorial-close");

  document.getElementById("btn-intro-fg-tutorial")?.addEventListener("click", () => openFgTutorial(0));

  btnClose?.addEventListener("click", () => closeTutorial(true));
  backdrop?.addEventListener("click", (e) => {
    if (e.target === backdrop) closeTutorial(true);
  });

  btnPrev?.addEventListener("click", () => {
    if (currentStep > 0) {
      currentStep -= 1;
      renderStep(currentStep);
    }
  });

  btnNext?.addEventListener("click", () => {
    if (currentStep < STEPS.length - 1) {
      currentStep += 1;
      renderStep(currentStep);
      return;
    }
    closeTutorial(true);
  });

  document.addEventListener("keydown", (e) => {
    if (!backdrop || backdrop.classList.contains("hidden")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeTutorial(true);
      return;
    }
    if (e.key === "ArrowRight" || e.key === "Enter") {
      e.preventDefault();
      btnNext?.click();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      btnPrev?.click();
    }
  });
}
