/** Shared logic for auto „Sicht des Modells“ + localStorage overrides from Kurator. */

export const MIN_MODEL_SEED_VOTES = 4;
export const PERSPECTIVE_OVERRIDE_STORAGE_KEY = "jufo_perspective_overrides";

export const WEAK_MODEL_PERSPECTIVE_FGS = new Set(["C=C (Alken)", "Ether (–O–)"]);

export const POOL_MODEL_PERSPECTIVE_OVERRIDES = {
  random_1: {
    title: "Sicht des Modells",
    paragraphs: [
      "Das Modell wählt überwiegend Molekül #4. Möglicherweise weil es — anders als #1, #2 und #3 — kein Stickstoff-Fragment hat.",
    ],
  },
  random_2: null,
  random_10: null,
  scaffold_similar_18: {
    title: "Sicht des Modells",
    paragraphs: [
      "Das Modell wählt überwiegend Molekül #1. Möglicherweise weil es — anders als #2 und #3 — kein Stickstoff-Fragment hat.",
    ],
  },
};

export function poolPerspectiveKey(setData) {
  return `${setData.strategy}_${setData.set_idx}`;
}

export function loadPerspectiveOverrides() {
  try {
    const raw = localStorage.getItem(PERSPECTIVE_OVERRIDE_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
}

export function savePerspectiveOverrides(overrides) {
  localStorage.setItem(PERSPECTIVE_OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
}

export function isWeakModelPerspective(criterion, mode) {
  return mode === "exclusive" && criterion.length && WEAK_MODEL_PERSPECTIVE_FGS.has(criterion[0]);
}

export function modelSeedVoteCount(setData, molIdx) {
  const fg = setData._fgAnalysis;
  if (fg?.model_seed_votes != null && fg.model_pred_idx === molIdx) {
    return fg.model_seed_votes;
  }
  return (setData._seedEntries || []).filter((s) => s.predIdx === molIdx).length;
}

export function resolveModelCriterion(fg) {
  if (fg?.model_without_n_fg) return { criterion: [], mode: "no_n" };
  const criterion = fg?.model_criterion_de || [];
  const mode = fg?.model_criterion_mode || "";
  if (criterion.length && mode && !isWeakModelPerspective(criterion, mode)) {
    return { criterion, mode };
  }
  if (mode === "no_n") return { criterion: [], mode: "no_n" };
  const lacks = fg?.model_lacks_fgs_de || [];
  if (lacks.length) return { criterion: lacks.slice(0, 1), mode: "lacks" };
  const exclusive = fg?.model_exclusive_fgs_de || [];
  if (exclusive.length && !isWeakModelPerspective(exclusive.slice(0, 1), "exclusive")) {
    return { criterion: exclusive.slice(0, 1), mode: "exclusive" };
  }
  if (fg?.model_without_n_fg) return { criterion: [], mode: "no_n" };
  return { criterion: [], mode: "" };
}

export function formatMolNumsList(indices) {
  const nums = [...indices].sort((a, b) => a - b).map((i) => i + 1);
  if (nums.length === 0) return "";
  if (nums.length === 1) return `#${nums[0]}`;
  if (nums.length === 2) return `#${nums[0]} und #${nums[1]}`;
  return `${nums.slice(0, -1).map((n) => `#${n}`).join(", ")} und #${nums[nums.length - 1]}`;
}

export function exclusiveFgIsUniqueInLabels(setData, modelIdx, fgDe) {
  return !setData.molecules.some(
    (mol, i) => i !== modelIdx && (mol.fg_labels_de || []).includes(fgDe)
  );
}

export function buildAutoPerspectiveText(setData, { criterion, mode, modelIdx }) {
  const modelNum = modelIdx + 1;
  const othersStr = formatMolNumsList(
    setData.molecules.map((_, i) => i).filter((i) => i !== modelIdx)
  );
  const lead = `Das Modell wählt überwiegend Molekül #${modelNum}. Möglicherweise weil `;

  if (mode === "exclusive" && criterion.length) {
    if (!exclusiveFgIsUniqueInLabels(setData, modelIdx, criterion[0])) return null;
    return `${lead}[[${criterion[0]}]] nur in #${modelNum} ist.`;
  }
  if (mode === "lacks" && criterion.length) {
    return `${lead}${othersStr} [[${criterion[0]}]] haben — #${modelNum} nicht.`;
  }
  if (mode === "no_n") {
    return `${lead}es — anders als ${othersStr} — kein Stickstoff-Fragment hat.`;
  }
  return null;
}

export function getAlgorithmicPerspectiveCandidate(setData) {
  const fg = setData._fgAnalysis;
  if (!fg) return null;

  const gtIdx = setData.ground_truth_ooo_idx;
  const modelIdx = fg.model_pred_idx ?? setData._modelPredIdx;
  if (modelIdx == null || modelIdx === gtIdx || !fg.model_alt_correct) return null;
  if (modelSeedVoteCount(setData, modelIdx) < MIN_MODEL_SEED_VOTES) return null;

  const resolved = resolveModelCriterion(fg);
  if (isWeakModelPerspective(resolved.criterion, resolved.mode)) return null;

  const text = buildAutoPerspectiveText(setData, { ...resolved, modelIdx });
  if (!text) return null;

  return {
    title: "Sicht des Modells",
    paragraphs: [text],
    auto: true,
    _meta: {
      modelIdx,
      criterion: resolved.criterion,
      mode: resolved.mode,
      votes: modelSeedVoteCount(setData, modelIdx),
    },
  };
}

export function getEffectiveModelPerspective(setData, overrides = loadPerspectiveOverrides()) {
  const key = poolPerspectiveKey(setData);
  const stored = overrides[key];

  if (stored?.status === "suppressed") return null;
  if (stored?.status === "edited" && stored.perspective) return stored.perspective;
  if (stored?.status === "approved") {
    return (
      getAlgorithmicPerspectiveCandidate(setData) ||
      setData._fgAnalysis?.model_perspective_de ||
      null
    );
  }

  if (Object.prototype.hasOwnProperty.call(POOL_MODEL_PERSPECTIVE_OVERRIDES, key)) {
    return POOL_MODEL_PERSPECTIVE_OVERRIDES[key];
  }

  const baked = setData._fgAnalysis?.model_perspective_de;
  if (baked && !baked.auto) return baked;

  return getAlgorithmicPerspectiveCandidate(setData) || baked || null;
}

export function listPerspectiveReviewCandidates(allSets, overrides = loadPerspectiveOverrides()) {
  const keys = new Set();
  const out = [];

  for (const setData of allSets) {
    const key = poolPerspectiveKey(setData);
    if (keys.has(key)) continue;

    const candidate = getAlgorithmicPerspectiveCandidate(setData);
    const baked = setData._fgAnalysis?.model_perspective_de;
    const hasBakedAuto = baked?.auto || baked?.paragraphs?.length;
    const stored = overrides[key];

    if (!candidate && !hasBakedAuto && !stored) continue;

    keys.add(key);
    out.push({
      setData,
      key,
      candidate: candidate || baked,
      stored: stored || null,
      effective: getEffectiveModelPerspective(setData, overrides),
    });
  }

  return out.sort((a, b) => {
    if (a.setData.strategy !== b.setData.strategy) {
      return a.setData.strategy.localeCompare(b.setData.strategy);
    }
    return a.setData.set_idx - b.setData.set_idx;
  });
}

export function exportPerspectiveOverridesForBuild(overrides = loadPerspectiveOverrides()) {
  const lines = ["POOL_MODEL_PERSPECTIVE_OVERRIDES = {"];
  for (const [key, entry] of Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b))) {
    if (entry.status === "suppressed") {
      lines.push(`    "${key}": None,`);
    } else if (entry.status === "edited" && entry.perspective?.paragraphs?.length) {
      const paras = entry.perspective.paragraphs.map((p) => JSON.stringify(p, null, 0)).join(",\n            ");
      lines.push(`    "${key}": {
        "title": ${JSON.stringify(entry.perspective.title || "Sicht des Modells")},
        "paragraphs": [
            ${paras}
        ],
        "auto": True,
    },`);
    }
  }
  lines.push("}");
  return lines.join("\n");
}
