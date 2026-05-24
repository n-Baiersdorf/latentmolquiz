#!/usr/bin/env python3
"""Build script: RDKit PNGs from SMILES + static bundle for dist/ and docs/."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
DATEN = ROOT / "Daten"
GALLERY = ROOT / "gallery"
SRC = ROOT / "src"
DIST = ROOT / "dist"
DOCS = ROOT / "docs"

PNG_SIZE = (400, 400)
INFERENCE_GLOB = "inference_*_set*.json"

# Priority-ordered fragment detectors (human label, RDKit fr_* name)
FG_DETECTORS: list[tuple[str, str]] = [
    ("Carboxylic acid", "fr_COO"),
    ("Carboxylate", "fr_COO2"),
    ("Ester", "fr_ester"),
    ("Amide", "fr_amide"),
    ("Nitrile", "fr_nitrile"),
    ("Primary amine", "fr_NH2"),
    ("Secondary amine", "fr_NH1"),
    ("Tertiary amine", "fr_NH0"),
    ("Alcohol", "fr_Al_OH"),
    ("Phenol", "fr_Ar_OH"),
    ("Ether", "fr_ether"),
    ("Ketone", "fr_ketone"),
    ("Aldehyde", "fr_aldehyde"),
    ("Halogen", "fr_halogen"),
    ("Aromatic", "fr_benzene"),
    ("Sulfonamide", "fr_sulfonamd"),
    ("Thiol", "fr_SH"),
]

FG_DE: dict[str, str] = {
    "Carboxylic acid": "Carbonsäure",
    "Carboxylate": "Carboxylat",
    "Ester": "Ester",
    "Amide": "Amid",
    "Nitrile": "Nitril",
    "Primary amine": "Primäres Amin",
    "Secondary amine": "Sekundäres Amin",
    "Tertiary amine": "Tertiäres Amin",
    "Alcohol": "Alkohol",
    "Phenol": "Phenol",
    "Ether": "Ether",
    "Ketone": "Keton",
    "Aldehyde": "Aldehyd",
    "Halogen": "Halogen",
    "Aromatic": "Aromat",
    "Sulfonamide": "Sulfonamid",
    "Thiol": "Thiol",
    "unknown": "Unbekannt",
}

FG_EXPLAIN_DE: dict[str, str] = {
    "Carboxylic acid": "Carbonsäure (-COOH): sauer, polare Gruppe",
    "Carboxylate": "Carboxylat (-COO⁻): salzartige, polare Form der Carbonsäure",
    "Ester": "Ester (-COO-): Sauerstoff zwischen zwei Kohlenstoff-Fragmenten",
    "Amide": "Amid (-CONH-): Stickstoff direkt an einer Carbonylgruppe (C=O)",
    "Nitrile": "Nitril (-C≡N): Stickstoff dreifach an Kohlenstoff gebunden",
    "Primary amine": "Primäres Amin (-NH₂): Stickstoff mit zwei Wasserstoffen",
    "Secondary amine": "Sekundäres Amin (-NH-): Stickstoff mit zwei C-N-Bindungen",
    "Tertiary amine": "Tertiäres Amin (-N≡): Stickstoff mit drei C-N-Bindungen, kein N-H",
    "Alcohol": "Alkohol (-OH): Sauerstoff mit Wasserstoff direkt am Kohlenstoff",
    "Phenol": "Phenol (-OH am Ring): Hydroxylgruppe an einem aromatischen Ring",
    "Ether": "Ether (-O-): Sauerstoff verbindet zwei Kohlenstoff-Reste",
    "Ketone": "Keton (C=O): doppelbindiger Sauerstoff zwischen zwei Kohlenstoffen",
    "Aldehyde": "Aldehyd (-CHO): Carbonylgruppe am Kettenende",
    "Halogen": "Halogen (-F, -Cl, …): Fluor, Chlor oder ähnliches am Kohlenstoff",
    "Aromatic": "Aromat: ringförmiges System mit delokalisierten Elektronen (z. B. Benzol)",
    "Sulfonamide": "Sulfonamid: Schwefel-Sauerstoff-Gruppe mit Stickstoff",
    "Thiol": "Thiol (-SH): Schwefel analog zum Alkohol",
    "unknown": "Keine typische Gruppe erkannt",
}

FG_ORDER = {name: i for i, (name, _) in enumerate(FG_DETECTORS)}

N_FG_EN = frozenset(
    {
        "Primary amine",
        "Secondary amine",
        "Tertiary amine",
        "Amide",
        "Nitrile",
        "Sulfonamide",
    }
)


def fg_to_de(label: str | None) -> str | None:
    if not label:
        return None
    return FG_DE.get(label, label)


def try_rdkit():
    try:
        from rdkit import Chem
        from rdkit.Chem import Draw

        return Chem, Draw
    except ImportError:
        return None, None


def placeholder_png(path: Path, smiles: str, mol_idx: int) -> None:
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", PNG_SIZE, color=(32, 36, 44))
    draw = ImageDraw.Draw(img)
    draw.rectangle([24, 24, 376, 376], outline=(100, 116, 139), width=2)
    label = f"#{mol_idx + 1}"
    draw.text((200, 170), label, fill=(203, 213, 225), anchor="mm")
    snippet = smiles if len(smiles) <= 36 else smiles[:33] + "..."
    draw.text((200, 210), snippet, fill=(148, 163, 184), anchor="mm")
    draw.text((200, 250), "(Platzhalter)", fill=(100, 116, 139), anchor="mm")
    img.save(path, "PNG")


def smiles_to_png(smiles: str, path: Path, mol_idx: int, Chem, Draw) -> str:
    """Return method used: 'rdkit' or 'placeholder'."""
    if Chem is not None:
        mol = Chem.MolFromSmiles(smiles)
        if mol is not None:
            img = Draw.MolToImage(mol, size=PNG_SIZE)
            img.save(path, "PNG")
            return "rdkit"
    placeholder_png(path, smiles, mol_idx)
    return "placeholder"


def refine_fg_labels(labels: list[str]) -> list[str]:
    """Drop free-amine tags when an amide is present — the N belongs to the amide."""
    if "Amide" in labels:
        labels = [label for label in labels if label not in ("Primary amine", "Secondary amine")]
    return labels


def detect_molecule_fgs(smiles: str, Chem) -> tuple[str | None, list[str]]:
    """Return (fg_primary, fg_labels) — only human-readable RDKit fragment names."""
    mol = Chem.MolFromSmiles(smiles) if Chem else None
    if mol is None:
        return None, []

    from rdkit.Chem import Fragments

    labels: list[str] = []
    for name, fn_name in FG_DETECTORS:
        fn = getattr(Fragments, fn_name, None)
        if fn and fn(mol) > 0:
            labels.append(name)

    labels = refine_fg_labels(labels)

    if labels:
        return labels[0], labels

    return "unknown", ["unknown"]


def mol_formula_from_smiles(smiles: str, Chem) -> str | None:
    if Chem is None:
        return None
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    from rdkit.Chem import rdMolDescriptors

    return rdMolDescriptors.CalcMolFormula(mol)


def sort_fgs_en(labels: list[str]) -> list[str]:
    return sorted(labels, key=lambda name: FG_ORDER.get(name, 999))


def exclusive_labels(idx: int, all_labels_en: list[list[str]]) -> set[str]:
    others = [set(all_labels_en[i]) for i in range(len(all_labels_en)) if i != idx]
    if not others:
        return set()
    union = set.union(*others)
    return set(all_labels_en[idx]) - union


def lacks_shared_labels(idx: int, all_labels_en: list[list[str]]) -> set[str]:
    others = [set(all_labels_en[i]) for i in range(len(all_labels_en)) if i != idx]
    if not others:
        return set()
    shared = set.intersection(*others)
    return shared - set(all_labels_en[idx])


def has_nitrogen_fg(labels: list[str]) -> bool:
    return bool(N_FG_EN & set(labels))


def compute_fg_analysis(
    data: dict,
    primary_fgs: list[str | None],
    all_labels_en: list[list[str]],
) -> dict:
    """Set-level FG analysis including alternative GT candidates."""
    from collections import Counter

    gt_idx = data["ground_truth_ooo_idx"]
    n = len(primary_fgs)
    counts = Counter(fg for fg in primary_fgs if fg)
    majority_fg = counts.most_common(1)[0][0] if counts else None
    majority_count = counts.most_common(1)[0][1] if counts else 0

    other_primaries_de: list[str] = []
    for i, fg in enumerate(primary_fgs):
        if i == gt_idx:
            continue
        de = fg_to_de(fg)
        if de and de not in other_primaries_de:
            other_primaries_de.append(de)

    alt_gt_indices: list[int] = []
    alt_gt_fgs: dict[str, str] = {}
    for i, fg in enumerate(primary_fgs):
        if i == gt_idx:
            continue
        excl = exclusive_labels(i, all_labels_en)
        lacks = lacks_shared_labels(i, all_labels_en)
        only_no_n = not has_nitrogen_fg(all_labels_en[i]) and all(
            has_nitrogen_fg(all_labels_en[j]) for j in range(n) if j != i
        )
        if excl or lacks or only_no_n or (fg and counts.get(fg, 0) == 1):
            alt_gt_indices.append(i)
            if excl:
                alt_gt_fgs[str(i)] = sort_fgs_en(list(excl))[0]
            elif lacks:
                alt_gt_fgs[str(i)] = sort_fgs_en(list(lacks))[0]
            elif fg and counts.get(fg, 0) == 1:
                alt_gt_fgs[str(i)] = fg

    seed_preds = [s["ooo_pred_idx"] for s in data.get("per_seed", {}).values()]
    votes: dict[int, int] = {}
    for p in seed_preds:
        votes[p] = votes.get(p, 0) + 1
    model_pred_idx = max(votes, key=votes.get) if votes else gt_idx

    model_excl_en = exclusive_labels(model_pred_idx, all_labels_en) if model_pred_idx != gt_idx else set()
    model_lacks_en = lacks_shared_labels(model_pred_idx, all_labels_en) if model_pred_idx != gt_idx else set()
    model_without_n = (
        model_pred_idx != gt_idx
        and not has_nitrogen_fg(all_labels_en[model_pred_idx])
        and all(
            has_nitrogen_fg(all_labels_en[j])
            for j in range(n)
            if j != model_pred_idx
        )
    )

    model_alt_correct = model_pred_idx != gt_idx and bool(
        model_excl_en or model_lacks_en or model_without_n
    )

    shared_en: set[str] = set(all_labels_en[0]) if all_labels_en else set()
    for labels in all_labels_en[1:]:
        shared_en &= set(labels)
    shared_fgs_de = [fg_to_de(f) for f in sort_fgs_en(list(shared_en)) if fg_to_de(f)]

    gt_en = set(all_labels_en[gt_idx]) if gt_idx < len(all_labels_en) else set()
    others = [set(all_labels_en[i]) for i in range(len(all_labels_en)) if i != gt_idx]
    gt_extra_en = [
        fg for fg in gt_en if others and not any(fg in other for other in others)
    ]
    gt_extra_fgs_de = [fg_to_de(f) for f in sort_fgs_en(gt_extra_en) if fg_to_de(f)]

    non_gt_shared_en: set[str] = set()
    if others:
        non_gt_shared_en = set.intersection(*others)
    non_gt_shared_fgs_de = [
        fg_to_de(f) for f in sort_fgs_en(list(non_gt_shared_en)) if fg_to_de(f)
    ]
    gt_lacks_en = [fg for fg in non_gt_shared_en if fg not in gt_en]
    gt_lacks_fgs_de = [fg_to_de(f) for f in sort_fgs_en(gt_lacks_en) if fg_to_de(f)]

    all_en: set[str] = set()
    for labels in all_labels_en:
        all_en.update(labels)
    glossary: dict[str, str] = {}
    for en in sort_fgs_en(list(all_en)):
        de = fg_to_de(en)
        if de and en in FG_EXPLAIN_DE:
            glossary[de] = FG_EXPLAIN_DE[en]

    return {
        "majority_fg": majority_fg,
        "majority_fg_de": fg_to_de(majority_fg),
        "majority_count": majority_count,
        "other_primaries_de": other_primaries_de,
        "gt_fg": primary_fgs[gt_idx] if gt_idx < n else None,
        "gt_fg_de": fg_to_de(primary_fgs[gt_idx] if gt_idx < n else None),
        "gt_idx": gt_idx,
        "shared_fgs_de": shared_fgs_de,
        "non_gt_shared_fgs_de": non_gt_shared_fgs_de,
        "gt_lacks_fgs_de": gt_lacks_fgs_de,
        "gt_extra_fgs_de": gt_extra_fgs_de,
        "glossary": glossary,
        "alt_gt_indices": alt_gt_indices,
        "alt_gt_fgs": alt_gt_fgs,
        "alt_gt_fgs_de": {k: fg_to_de(v) for k, v in alt_gt_fgs.items()},
        "model_pred_idx": model_pred_idx,
        "model_alt_correct": model_alt_correct,
        "model_exclusive_fgs_de": [
            fg_to_de(f) for f in sort_fgs_en(list(model_excl_en)) if fg_to_de(f)
        ],
        "model_lacks_fgs_de": [
            fg_to_de(f) for f in sort_fgs_en(list(model_lacks_en)) if fg_to_de(f)
        ],
        "model_without_n_fg": model_without_n,
        "source": "rdkit",
    }


def enrich_functional_groups(data: dict, Chem) -> dict:
    """Add formula, FG labels (DE), and fg_analysis at set level."""
    primary_fgs: list[str | None] = []
    all_labels_en: list[list[str]] = []
    for mol in data["molecules"]:
        primary, labels = detect_molecule_fgs(mol["smiles"], Chem)
        mol["fg_primary"] = primary
        mol["fg_labels"] = labels
        mol["fg_primary_de"] = fg_to_de(primary)
        mol["fg_labels_de"] = [fg_to_de(l) for l in labels if l and fg_to_de(l)]
        mol["mol_formula"] = mol_formula_from_smiles(mol["smiles"], Chem)
        primary_fgs.append(primary)
        all_labels_en.append(labels)

    data["fg_analysis"] = compute_fg_analysis(data, primary_fgs, all_labels_en)
    return data


def collect_inference_files() -> list[Path]:
    files = sorted(DATEN.glob(INFERENCE_GLOB))
    return [f for f in files if f.name.count("_set") == 1]


def generate_gallery(inference_files: list[Path]) -> dict:
    Chem, Draw = try_rdkit()
    stats = {"rdkit": 0, "placeholder": 0, "sets": 0, "images": 0}
    GALLERY.mkdir(parents=True, exist_ok=True)

    for json_path in inference_files:
        data = json.loads(json_path.read_text(encoding="utf-8"))
        strategy = data["strategy"]
        set_idx = data["set_idx"]
        stats["sets"] += 1

        for mol_idx, mol in enumerate(data["molecules"]):
            png_name = f"{strategy}_set{set_idx}_mol{mol_idx}.png"
            png_path = GALLERY / png_name
            method = smiles_to_png(mol["smiles"], png_path, mol_idx, Chem, Draw)
            stats[method] += 1
            stats["images"] += 1

    return stats


def copy_tree(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def build_bundle(target: Path, inference_files: list[Path]) -> None:
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    for item in SRC.rglob("*"):
        rel = item.relative_to(SRC)
        dest = target / rel
        if item.is_dir():
            dest.mkdir(parents=True, exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, dest)

    # Config files
    for name in (
        "config.json",
        "config.example.json",
        "WISSENSCHAFTLICHE_EINORDNUNG.md",
        "WISSENSCHAFTLICHE_EINORDNUNG.full.md",
    ):
        src = ROOT / name
        if src.exists():
            shutil.copy2(src, target / name)

    info_figures = SRC / "info-figures"
    if info_figures.is_dir():
        dst_figures = target / "info-figures"
        if dst_figures.exists():
            shutil.rmtree(dst_figures)
        shutil.copytree(info_figures, dst_figures)

    # Data JSONs (enriched with FG analysis)
    data_dir = target / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    Chem, _ = try_rdkit()

    needed = set()
    for json_path in inference_files:
        data = json.loads(json_path.read_text(encoding="utf-8"))
        if Chem is not None:
            data = enrich_functional_groups(data, Chem)
        strategy = data["strategy"]
        set_idx = data["set_idx"]
        for mol_idx in range(len(data["molecules"])):
            needed.add(f"{strategy}_set{set_idx}_mol{mol_idx}.png")
        (data_dir / json_path.name).write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    # Gallery PNGs
    gallery_dst = target / "gallery"
    gallery_dst.mkdir(parents=True, exist_ok=True)

    for png_name in sorted(needed):
        src = GALLERY / png_name
        if src.exists():
            shutil.copy2(src, gallery_dst / png_name)

    if (GALLERY / "set_index.json").exists():
        shutil.copy2(GALLERY / "set_index.json", gallery_dst / "set_index.json")

    # GitHub Pages: Jekyll deaktivieren (sonst Probleme mit data/, js/, etc.)
    (target / ".nojekyll").touch()


def deploy_bundle(target: Path, inference_files: list[Path]) -> None:
    """Build into a staging dir, then swap — keeps a running dev server on target alive."""
    staging = target.parent / f".{target.name}.staging"
    backup = target.parent / f".{target.name}.bak"

    if staging.exists():
        shutil.rmtree(staging)
    build_bundle(staging, inference_files)

    if backup.exists():
        shutil.rmtree(backup)
    if target.exists():
        target.rename(backup)
    staging.rename(target)
    if backup.exists():
        shutil.rmtree(backup)


def main() -> int:
    print("JuFo MultiMol OOO-Quiz — Build")
    print("=" * 40)

    inference_files = collect_inference_files()
    if not inference_files:
        print("Keine Inference-JSONs in Daten/ gefunden.", file=sys.stderr)
        return 1

    Chem, _ = try_rdkit()
    if Chem is None:
        print("Hinweis: RDKit nicht installiert — Platzhalter-PNGs, keine FG-Labels.")
    else:
        print("RDKit gefunden — Strukturbilder + Funktionsgruppen.")

    print(f"Generiere Bilder für {len(inference_files)} Sets …")
    stats = generate_gallery(inference_files)
    print(
        f"  {stats['images']} Bilder "
        f"({stats['rdkit']} RDKit, {stats['placeholder']} Platzhalter)"
    )

    print("Erstelle dist/ …")
    deploy_bundle(DIST, inference_files)
    print("Erstelle docs/ …")
    deploy_bundle(DOCS, inference_files)

    print("Fertig.")
    print(f"  dist/:  {DIST}")
    print(f"  docs/:  {DOCS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
