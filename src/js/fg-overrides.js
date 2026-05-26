/** FG-Overrides (localStorage) — ohne UI-Abhängigkeiten. */

export const FG_OVERRIDE_STORAGE_KEY = "jufo_fg_overrides";

export function loadFgOverrides() {
  try {
    const raw = localStorage.getItem(FG_OVERRIDE_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
}

export function saveFgOverrides(overrides) {
  localStorage.setItem(FG_OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
}

export function poolSetKey(setData) {
  return `${setData.strategy}_${setData.set_idx}`;
}

export function applyFgOverridesToMolecule(mol, setKey, molIdx) {
  const entry = loadFgOverrides()[setKey]?.[String(molIdx)];
  if (!entry?.fg_labels_de?.length) return mol;
  const labels = [...entry.fg_labels_de];
  return {
    ...mol,
    fg_labels_de: labels,
    fg_labels: labels,
    fg_primary_de: entry.fg_primary_de || labels[0],
    fg_primary: entry.fg_primary_de || labels[0],
    _fgCuratorOverride: true,
    _fgAutoLabelsDe: entry.auto_fg_labels_de || mol.fg_labels_de,
  };
}

export function applyFgOverridesToSet(data) {
  const key = poolSetKey(data);
  const molecules = data.molecules.map((mol, i) =>
    applyFgOverridesToMolecule(mol, key, i)
  );
  return { ...data, molecules };
}
