#!/usr/bin/env python3
"""Build script: RDKit PNGs from SMILES + static bundle for dist/ and docs/."""

from __future__ import annotations

import json
import re
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
PNG_PADDING = 0.12
PNG_BOND_LEN_MIN = 10.0
PNG_BOND_LEN_MAX = 28.0
PNG_BOND_LEN_REF = 20.0
PNG_REF_SPAN = 8.0
PNG_TUTORIAL_BOND_LEN = 14.0
INFERENCE_GLOB = "inference_*_set*.json"

TUTORIAL_PAIRS = [
    {"id": "p1", "smiles": ["CC(=O)C", "CCC=O"]},
    {"id": "p2", "smiles": ["CCO", "CCOCC"]},
    {"id": "p3", "smiles": ["CC(=O)O", "CCOC(=O)C"]},
    {"id": "p4", "smiles": ["CCN", "CNC"]},
    {"id": "p5", "smiles": ["CCN", "CC(=O)N"]},
]

# Priority-ordered detectors (human label, RDKit fr_* name; empty = custom SMARTS)
FG_DETECTORS: list[tuple[str, str]] = [
    ("Carboxylic acid", "fr_COO"),
    ("Carboxylate", "fr_COO2"),
    ("Ester", "fr_ester"),
    ("Amide", "fr_amide"),
    ("Lactam", ""),
    ("Nitrile", "fr_nitrile"),
    ("Imine C=N-C", ""),
    ("Imine C=N-H", ""),
    ("Ring N", ""),
    ("Ring N-H", ""),
    ("Ring O arom", ""),
    ("Ring O aliph", ""),
    ("Primary amine", ""),
    ("Secondary amine", ""),
    ("Tertiary amine", ""),
    ("Alcohol", "fr_Al_OH"),
    ("Ether", ""),
    ("Ketone", "fr_ketone"),
    ("Aldehyde", "fr_aldehyde"),
    ("Halogen", "fr_halogen"),
    ("Nitro", ""),
    ("Alkyne", ""),
    ("Alkene", ""),
]

# Custom SMARTS (RDKit fr_NH* matches any N by H-count, not true amines)
# Extra SMARTS tried after FG_CUSTOM_SMARTS miss (e.g. lactams in kekulized forms)
FG_EXTRA_SMARTS: dict[str, list[str]] = {
    "Lactam": ["[#7;R]C(=O)"],
}

FG_CUSTOM_SMARTS: dict[str, str] = {
    "Lactam": "[#7;R]~[#6](=[#8])",
    "Imine C=N-C": "[#6]=[#7;H0;!R;!$(n);!$(N-C(=O))]",
    "Imine C=N-H": "[#6]=[#7;H1;!R;!$(N-C(=O))]",
    "Ring N": "[n;R;H0;!$(nC=O)]",
    "Ring N-H": "[n;R;H1]",
    "Ring O arom": "[o;R]",
    "Ring O aliph": "[OD2;R;!$(O=[#6]);!o]",
    "Primary amine": "[NX3;H2;!$(NC=O)]",
    "Secondary amine": "[NX3;H1;!$(NC=O);!$(N=C)]",
    "Tertiary amine": "[NX3;H0;!$(N=C);!$(n);!$(N#*);!$(NC=O);!R](-[#6])(-[#6])-[#6]",
    "Ether": "[OD2;!R](-[#6])-[#6]",
    "Nitro": "[$([NX3](=O)=O),$([NX3+](=O)[O-])]",
    "Alkyne": "[CX2]#[CX2]",
    "Alkene": "[CX3]=[CX3]",
}

AMINE_LABELS = frozenset({"Primary amine", "Secondary amine", "Tertiary amine"})
N_BLOCKING_LABELS = frozenset(
    {"Amide", "Nitrile", "Imine C=N-C", "Imine C=N-H", "Nitro"}
)

RING_N_EN = frozenset({"Ring N", "Ring N-H"})
RING_O_EN = frozenset({"Ring O arom", "Ring O aliph"})
RING_O_AROM_EN = "Ring O arom"
IMINE_EN = frozenset({"Imine C=N-C", "Imine C=N-H"})
RING_NO_COMBINED_KEY = "_RING_NO_COMBINED"
RING_N_DISPLAY_DE = {"Ring N": "N im Ring", "Ring N-H": "N–H im Ring"}
COARSE_RING_N_DE = "N im Ring"
RING_NO_COMBINED_DE = "N und O im Ring (N,O-Heterocycl)"
MAX_JURY_LABELS = 3

FG_REF_DIR = "fg_ref"
# Chip label (or base without "N× ") → (filename slug, minimal schematic SMILES)
# Ring examples: only the relevant heteroatom pattern; chain examples: R-groups (C / CC).
FG_CHIP_REFERENCES: dict[str, tuple[str, str]] = {
    "–COOH (Carbonsäure)": ("carboxylic_acid", "CC(=O)O"),
    "–COO⁻ (Carboxylat)": ("carboxylate", "CC(=O)[O-]"),
    "–COOR (Ester)": ("ester", "CCOC(=O)C"),
    "–CONR– (Amid)": ("amide", "CC(=O)NC"),
    "C=O im Ring (Lactam)": ("lactam", "O=C1CCCN1"),
    "C≡N (Nitril)": ("nitrile", "CC#N"),
    "C=N–C (Imin)": ("imine_cnc", "CC=NC"),
    "C=N–H (Imin)": ("imine_nh", "CC=[NH]"),
    "N im Ring (Heterocycl)": ("ring_n_1", "c1ccncc1"),
    "N–H im Ring (Heterocycl)": ("ring_n_h_arom", "c1ccc[nH]1"),
    "O im aromatischen Ring": ("ring_o_arom", "c1ccoc1"),
    "O im Ring (cycl. Ether)": ("ring_o_aliph", "C1CO1"),
    RING_NO_COMBINED_DE: ("ring_no", "c1cnoc1"),
    "–NH₂ (primäres Amin)": ("primary_amine", "CCN"),
    "–NH– (sekundäres Amin)": ("secondary_amine", "CNC"),
    "tert. Amin (3× C–N)": ("tertiary_amine", "CN(C)C"),
    "–OH (Alkohol)": ("alcohol", "CCO"),
    "–OH im Ring (Heterocycl)": ("heterocyclic_oh", "Oc1ccncc1"),
    "Ether (–O–)": ("ether", "COC"),
    "C=O in der Kette (Keton)": ("ketone", "CC(=O)C"),
    "C=O am Kettenende (Aldehyd)": ("aldehyde", "CC=O"),
    "Halogen (F/Cl/…)": ("halogen", "CCCl"),
    "–NO₂ (Nitrogruppe)": ("nitro", "C[N+](=O)[O-]"),
    "C≡C (Alkin)": ("alkyne", "C#CC"),
    "C=C (Alken)": ("alkene", "C=CC"),
    "N mit Alkyl am Ring": ("ring_n_alkyl", "c1ccn(C)c1"),
    "1× N mit Alkyl am Ring": ("ring_n_alkyl", "c1ccn(C)c1"),
    "N mit N=N-Bindung": ("ring_n_nn_eq", "c1ccnnc1"),
    "2× N mit N=N-Bindung": ("ring_n_nn_eq_2x", "c1ccnnc1"),
    "N mit N–N-Bindung": ("ring_n_nn_single", "c1cn[nH]c1"),
    "2× N mit N–N-Bindung": ("ring_n_nn_single_2x", "c1cn[nH]c1"),
    "N im Ring": ("ring_n_plain", "c1ccncc1"),
    "2× N im Ring": ("ring_n_2x", "c1cncnc1"),
    "N–H im Ring": ("ring_n_h", "c1ccc[nH]1"),
    COARSE_RING_N_DE: ("ring_n_coarse", "c1ccncc1"),
}

# Display order for jury-facing chips (max MAX_JURY_LABELS per molecule)
# Labels shown in "Stattdessen" for the outlier (most distinctive first)
# Which exclusive GT reasons to show in the highlight (rarest / most decisive first)
FG_HIGHLIGHT_EXCLUSIVE_PRIORITY: list[str] = [
    "Halogen",
    "Nitro",
    "Ring O arom",
    "Ring O aliph",
    "Ring N",
    "Ring N-H",
    "Primary amine",
    "Lactam",
    "Nitrile",
    "Alkyne",
    "Alcohol",
    "Ether",
    "Aldehyde",
    "Ketone",
    "Ester",
    "Amide",
    "Imine C=N-C",
    "Imine C=N-H",
    "Alkene",
]

FG_INSTEAD_PRIORITY: list[str] = [
    "Ring O arom",
    "Ring O aliph",
    "Ether",
    "Alcohol",
    "Alkyne",
    "Nitro",
    "Imine C=N-C",
    "Imine C=N-H",
    "Primary amine",
    "Lactam",
    "Aldehyde",
    "Ketone",
    "Alkene",
]

FG_JURY_PRIORITY: list[str] = [
    "Ring N",
    "Ring N-H",
    "Ring O arom",
    "Ring O aliph",
    "Imine C=N-C",
    "Imine C=N-H",
    "Nitro",
    "Primary amine",
    "Lactam",
    "Ether",
    "Alcohol",
    "Alkyne",
    "Secondary amine",
    "Tertiary amine",
    "Alkene",
    "Ketone",
    "Aldehyde",
    "Ester",
    "Amide",
    "Nitrile",
    "Heterocyclic OH",
    "Halogen",
    "Carboxylic acid",
    "Carboxylate",
]

FG_DE: dict[str, str] = {
    "Carboxylic acid": "Carbonsäure",
    "Carboxylate": "Carboxylat",
    "Ester": "Ester",
    "Amide": "Amid",
    "Lactam": "C=O im Ring",
    "Nitrile": "Nitril",
    "Imine C=N-C": "C=N–C",
    "Imine C=N-H": "C=N–H",
    "Ring N": "N im Ring",
    "Ring N-H": "N–H im Ring",
    "Ring O arom": "O im arom. Ring",
    "Ring O aliph": "O im Ring (cycl.)",
    "Primary amine": "–NH₂",
    "Secondary amine": "Sekundäres Amin",
    "Tertiary amine": "Tertiäres Amin",
    "Alcohol": "–OH",
    "Heterocyclic OH": "Heterocycl-OH",
    "Ether": "Ether",
    "Ketone": "Keton",
    "Aldehyde": "Aldehyd",
    "Halogen": "Halogen",
    "Nitro": "–NO₂",
    "Alkyne": "C≡C",
    "Alkene": "Alken",
    "unknown": "Unbekannt",
}

# Chip text: structure (functional group) — keys match glossary lookup in UI
FG_DISPLAY_DE: dict[str, str] = {
    "Carboxylic acid": "–COOH (Carbonsäure)",
    "Carboxylate": "–COO⁻ (Carboxylat)",
    "Ester": "–COOR (Ester)",
    "Amide": "–CONR– (Amid)",
    "Lactam": "C=O im Ring (Lactam)",
    "Nitrile": "C≡N (Nitril)",
    "Imine C=N-C": "C=N–C (Imin)",
    "Imine C=N-H": "C=N–H (Imin)",
    "Ring N": "N im Ring (Heterocycl)",
    "Ring N-H": "N–H im Ring (Heterocycl)",
    "Ring O arom": "O im aromatischen Ring",
    "Ring O aliph": "O im Ring (cycl. Ether)",
    "Primary amine": "–NH₂ (primäres Amin)",
    "Secondary amine": "–NH– (sekundäres Amin)",
    "Tertiary amine": "tert. Amin (3× C–N)",
    "Alcohol": "–OH (Alkohol)",
    "Heterocyclic OH": "–OH im Ring (Heterocycl)",
    "Ether": "Ether (–O–)",
    "Ketone": "C=O in der Kette (Keton)",
    "Aldehyde": "C=O am Kettenende (Aldehyd)",
    "Halogen": "Halogen (F/Cl/…)",
    "Nitro": "–NO₂ (Nitrogruppe)",
    "Alkyne": "C≡C (Alkin)",
    "Alkene": "C=C (Alken)",
    "unknown": "Unbekannt",
}

FG_GLOSSARY_CHIP_DE: dict[str, str] = {
    "–COOH (Carbonsäure)": (
        "Struktur: –COOH (C=O plus –OH am selben C). Typisch: Carbonsäure."
    ),
    "–COO⁻ (Carboxylat)": (
        "Struktur: –COO⁻ (deprotonierte Carboxylgruppe). Typisch: Carboxylat-Anion."
    ),
    "–COOR (Ester)": (
        "Struktur: C=O mit –O– zu einem zweiten C (–COOR). Typisch: Ester."
    ),
    "–CONR– (Amid)": (
        "Struktur: C=O–N (–CONH₂, –CONHR oder –CONR₂). Typisch: Amid. "
    ),
    "C=O im Ring (Lactam)": (
        "Cyclisches Amid: C=O und N im selben Ring. Nicht mit Keton verwechseln."
    ),
    "C≡N (Nitril)": "Struktur: C≡N-Dreifachbindung. Typisch: Nitril.",
    "C=N–C (Imin)": (
        "Struktur: C=N–C (kein N–H). Typisch: Imin."
    ),
    "C=N–H (Imin)": (
        "Struktur: C=N–H. Typisch: primäres Imin (Aldimin)."
    ),
    RING_NO_COMBINED_DE: (
        "Aromatischer Ring mit N und O (N,O-Heterozyklus)."
    ),
    "N im Ring (Heterocycl)": (
        "Grob: aromatischer Ring-N ohne H (z. B. Pyridin). Details in der Tabelle."
    ),
    "N–H im Ring (Heterocycl)": (
        "Grob: aromatischer Ring-N mit H (z. B. Pyrrol). Details in der Tabelle."
    ),
    "O im aromatischen Ring": (
        "sp2-O im aromatischen Ring (z. B. Furan). Nicht Ether und nicht gesättigtes Ring-O."
    ),
    "O im Ring (cycl. Ether)": (
        "Gesättigtes Ring-O (sp3) zwischen zwei C, z. B. Epoxid/THF. Nicht Ketten-Ether."
    ),
    "–NH₂ (primäres Amin)": (
        "NH₂ an Kette, nicht im Ring. Typisch: primäres Amin."
    ),
    "–NH– (sekundäres Amin)": (
        "N mit einem H und zwei C-Nachbarn. Typisch: sekundäres Amin."
    ),
    "tert. Amin (3× C–N)": (
        "N ohne H, drei C-Nachbarn. Typisch: tertiäres Amin."
    ),
    "–OH (Alkohol)": (
        "OH an sp3-C (Kette). Typisch: Alkohol."
    ),
    "–OH im Ring (Heterocycl)": (
        "OH an heteroaromatischem Ring. Tautomerie möglich."
    ),
    "Ether (–O–)": (
        "O zwischen zwei C, nicht im Ring. Typisch: Ether."
    ),
    "C=O in der Kette (Keton)": (
        "C=O zwischen zwei C-Resten. Typisch: Keton."
    ),
    "C=O am Kettenende (Aldehyd)": (
        "C=O am Kettenende (–CHO). Typisch: Aldehyd."
    ),
    "Halogen (F/Cl/…)": (
        "F/Cl/Br/I als Substituent."
    ),
    "–NO₂ (Nitrogruppe)": (
        "–NO₂ an C. Typisch: Nitrogruppe."
    ),
    "C≡C (Alkin)": (
        "C≡C-Dreifachbindung, nicht aromatisch."
    ),
    "C=C (Alken)": (
        "C=C außerhalb aromatischer Systeme."
    ),
    "Unbekannt": "Keine typische Gruppe erkannt.",
}

# Ring-N subtypes (SMARTS, base chip label) — replaces coarse "3× N im Ring"
RING_N_SUBTYPE_PATTERNS: list[tuple[str, str, str]] = [
    ("N_ring_alkyl", "[n;R;H0;D3;!$(nC=O)]", "N mit Alkyl am Ring"),
    ("N_ring_plain", "[n;R;H0;D2;!$(n~[n;R])]", "N im Ring"),
    ("N_ring_H", "[n;R;H1]", "N–H im Ring"),
]

RING_N_CHIP_GLOSSARY_DE: dict[str, str] = {
    "N mit Alkyl am Ring": (
        "Ring-N ohne H, mit Alkyl-Substituent (z. B. N-Methyl)."
    ),
    "N mit N=N-Bindung": (
        "Benachbarte Ring-N mit N=N (Kekulé). RDKit zählt je nach Darstellung; 2x = zwei solche Bindungen."
    ),
    "N mit N–N-Bindung": (
        "Benachbarte Ring-N mit N–N-Einzelbindung (Kekulé). Oft zusätzlich N–H."
    ),
    "N im Ring": (
        "Fein: aromatischer Ring-N ohne H (Pyridin-typ). Nicht N–H und nicht N–N-Sonderfall."
    ),
    "N–H im Ring": (
        "Fein: aromatischer Ring-N mit H (Pyrrol-typ)."
    ),
}

RING_N_PLURAL_GLOSSARY_DE: dict[str, str] = {
    "N im Ring": (
        "Zwei oder mehr Ring-N ohne H (z. B. Pyrimidin)."
    ),
    "N–H im Ring": (
        "Zwei oder mehr Ring-N mit H."
    ),
    "N mit N=N-Bindung": (
        "Zwei N=N-Bindungen zwischen benachbarten Ring-N (Kekulé)."
    ),
    "N mit N–N-Bindung": (
        "Zwei N–N-Einzelbindungen zwischen benachbarten Ring-N (Kekulé)."
    ),
}

COARSE_RING_N_GLOSSARY = (
    "Grobe Einordnung: mindestens ein aromatischer Ring-N; Details in der Tabelle."
)

FG_ORDER = {name: i for i, (name, _) in enumerate(FG_DETECTORS)}

N_FG_EN = frozenset(
    {
        "Primary amine",
        "Secondary amine",
        "Tertiary amine",
        "Amide",
        "Lactam",
        "Nitrile",
        "Imine C=N-C",
        "Imine C=N-H",
        "Ring N",
        "Ring N-H",
        "Nitro",
    }
)

_FG_PATTERN_CACHE: dict[str, object] = {}


def fg_to_de(label: str | None) -> str | None:
    if not label:
        return None
    return FG_DE.get(label, label)


def fg_display_de(label: str | None) -> str | None:
    """UI chip text: structure (functional group)."""
    if not label:
        return None
    return FG_DISPLAY_DE.get(label, FG_DE.get(label, label))


def glossary_for_ring_n_chip(chip: str) -> str | None:
    if "×" in chip:
        count_str, base = chip.split("× ", 1)
        base = base.strip()
        try:
            n = int(count_str.strip())
        except ValueError:
            n = 1
        if n > 1:
            plural = RING_N_PLURAL_GLOSSARY_DE.get(base)
            if plural:
                return f"{chip}: {plural}"
        base_text = RING_N_CHIP_GLOSSARY_DE.get(base)
        if base_text:
            return f"{chip}: {base_text}"
        return None
    return RING_N_CHIP_GLOSSARY_DE.get(chip)


def chip_label_base(chip: str) -> str:
    if "×" in chip:
        _, base = chip.split("× ", 1)
        return base.strip()
    return chip


def chip_reference_image(chip: str) -> str | None:
    """Relative path under gallery/ for the reference schematic, if defined."""
    base = chip_label_base(chip)
    ref = FG_CHIP_REFERENCES.get(chip) or FG_CHIP_REFERENCES.get(base)
    if not ref:
        return None
    slug, _smiles = ref
    return f"{FG_REF_DIR}/{slug}.png"


def glossary_entry(text: str, chip: str) -> dict[str, str]:
    entry: dict[str, str] = {"text": text}
    image = chip_reference_image(chip)
    if image:
        entry["image"] = image
    return entry


def build_set_glossary(
    all_en: set[str], ring_chips: list[str]
) -> dict[str, dict[str, str]]:
    glossary: dict[str, dict[str, str]] = {}
    for en in sort_fgs_en(list(all_en)):
        chip = fg_display_de(en)
        if not chip or chip in glossary:
            continue
        if chip in FG_GLOSSARY_CHIP_DE:
            glossary[chip] = glossary_entry(FG_GLOSSARY_CHIP_DE[chip], chip)
    for chip in ring_chips:
        if chip in glossary:
            continue
        entry = glossary_for_ring_n_chip(chip)
        if entry:
            glossary[chip] = glossary_entry(entry, chip)
    if COARSE_RING_N_DE not in glossary:
        glossary[COARSE_RING_N_DE] = glossary_entry(COARSE_RING_N_GLOSSARY, COARSE_RING_N_DE)
    return glossary


def augment_glossary_from_display_labels(
    glossary: dict[str, dict[str, str]], molecules: list[dict]
) -> None:
    """Ensure every chip shown in the table is clickable (incl. combined N,O chip)."""
    for mol in molecules:
        for chip in mol.get("fg_labels_de") or mol.get("fg_labels") or []:
            if not chip or chip in glossary:
                continue
            text = FG_GLOSSARY_CHIP_DE.get(chip) or glossary_for_ring_n_chip(chip)
            if text:
                glossary[chip] = glossary_entry(text, chip)


RING_NN_EQ_REF_SLUGS = frozenset({"ring_n_nn_eq", "ring_n_nn_eq_2x"})


def build_ring_nn_eq_reference_mol(Chem):
    """Pyridazin-Kekulé (2 Ring-N) with visible N=N — RDKit sanitize would aromatize to N–N."""
    from rdkit.Chem import BondType

    em = Chem.EditableMol(Chem.Mol())
    for atomic_num in (7, 7, 6, 6, 6, 6):
        em.AddAtom(Chem.Atom(atomic_num))
    for i, j, order in (
        (0, 1, BondType.DOUBLE),
        (1, 2, BondType.SINGLE),
        (2, 3, BondType.DOUBLE),
        (3, 4, BondType.SINGLE),
        (4, 5, BondType.DOUBLE),
        (5, 0, BondType.SINGLE),
    ):
        em.AddBond(i, j, order)
    return em.GetMol()


def prepare_fg_reference_mol(slug: str, smiles: str, Chem, rdDepictor):
    if slug in RING_NN_EQ_REF_SLUGS:
        mol = build_ring_nn_eq_reference_mol(Chem)
        if mol is None:
            return None
        rdDepictor.Compute2DCoords(mol)
        return mol
    return prepare_mol_2d(smiles, Chem, rdDepictor)


def generate_fg_reference_pngs(Chem) -> int:
    """Small RDKit schematics for glossary popups (one per FG chip type)."""
    if Chem is None:
        return 0
    from rdkit.Chem import rdDepictor

    ref_dir = GALLERY / FG_REF_DIR
    ref_dir.mkdir(parents=True, exist_ok=True)
    slug_to_smiles: dict[str, str] = {}
    for _chip, (slug, smiles) in FG_CHIP_REFERENCES.items():
        slug_to_smiles.setdefault(slug, smiles)
    slugs = list(slug_to_smiles.keys())
    paths = [ref_dir / f"{slug}.png" for slug in slugs]
    if not slugs:
        return 0
    mols = [
        prepare_fg_reference_mol(slug, slug_to_smiles[slug], Chem, rdDepictor)
        for slug in slugs
    ]
    valid = [m for m in mols if m is not None]
    bond_len = (
        bond_length_for_mols(valid, canvas=PNG_SIZE[0])
        if valid
        else PNG_TUTORIAL_BOND_LEN
    )
    from rdkit.Chem.Draw import rdMolDraw2D

    for mol, path, idx, slug in zip(mols, paths, range(len(slugs)), slugs):
        if mol is not None:
            draw_mol_png(mol, path, bond_len, rdMolDraw2D)
        else:
            placeholder_png(path, slug_to_smiles[slug], idx)
    return len(slugs)


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


def prepare_mol_2d(smiles: str, Chem, rdDepictor):
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    rdDepictor.Compute2DCoords(mol)
    return mol


def mol_bounding_span(mol) -> float:
    conf = mol.GetConformer()
    n = mol.GetNumAtoms()
    if n == 0:
        return 0.5
    xs = [conf.GetAtomPosition(i).x for i in range(n)]
    ys = [conf.GetAtomPosition(i).y for i in range(n)]
    return max(max(xs) - min(xs), max(ys) - min(ys), 0.5)


def bond_length_for_mols(mols: list, canvas: int = PNG_SIZE[0]) -> float:
    spans = [mol_bounding_span(m) for m in mols if m is not None]
    if not spans:
        return PNG_BOND_LEN_REF
    max_span = max(spans)
    usable = canvas * (1 - 2 * PNG_PADDING)
    scale = (usable / max_span) * (PNG_BOND_LEN_REF / PNG_REF_SPAN)
    return max(PNG_BOND_LEN_MIN, min(PNG_BOND_LEN_MAX, scale))


def draw_mol_png(mol, path: Path, bond_length: float, rdMolDraw2D) -> None:
    drawer = rdMolDraw2D.MolDraw2DCairo(PNG_SIZE[0], PNG_SIZE[1])
    opts = drawer.drawOptions()
    opts.padding = PNG_PADDING
    opts.fixedBondLength = bond_length
    opts.fixedScale = True
    drawer.DrawMolecule(mol)
    drawer.FinishDrawing()
    path.write_bytes(drawer.GetDrawingText())


def render_smiles_batch(
    smiles_list: list[str],
    paths: list[Path],
    mol_indices: list[int],
    Chem,
    fixed_bond_length: float | None = None,
) -> list[str]:
    """Draw molecules with a shared bond length per batch (set-normalized)."""
    from rdkit.Chem import rdDepictor
    from rdkit.Chem.Draw import rdMolDraw2D

    mols = [prepare_mol_2d(s, Chem, rdDepictor) for s in smiles_list]
    bond_len = fixed_bond_length if fixed_bond_length is not None else bond_length_for_mols(mols)
    methods: list[str] = []
    for mol, path, idx, smiles in zip(mols, paths, mol_indices, smiles_list):
        if mol is not None:
            draw_mol_png(mol, path, bond_len, rdMolDraw2D)
            methods.append("rdkit")
        else:
            placeholder_png(path, smiles, idx)
            methods.append("placeholder")
    return methods


def smiles_to_png(smiles: str, path: Path, mol_idx: int, Chem, Draw) -> str:
    """Return method used: 'rdkit' or 'placeholder' (single molecule)."""
    if Chem is not None:
        methods = render_smiles_batch([smiles], [path], [mol_idx], Chem)
        return methods[0]
    placeholder_png(path, smiles, mol_idx)
    return "placeholder"


def fg_pattern(Chem, smarts: str):
    if smarts not in _FG_PATTERN_CACHE:
        _FG_PATTERN_CACHE[smarts] = Chem.MolFromSmarts(smarts)
    return _FG_PATTERN_CACHE[smarts]


def match_custom_fg(mol, Chem, smarts: str) -> bool:
    patt = fg_pattern(Chem, smarts)
    return bool(patt and mol.HasSubstructMatch(patt))


def count_custom_fg(mol, Chem, smarts: str) -> int:
    patt = fg_pattern(Chem, smarts)
    if not patt:
        return 0
    return len(mol.GetSubstructMatches(patt))


def refine_fg_labels(labels: list[str]) -> list[str]:
    """Drop amine tags when N belongs to amide, nitrile, imine, nitro, or sulfonamide."""
    if N_BLOCKING_LABELS & set(labels):
        labels = [label for label in labels if label not in AMINE_LABELS]
    return labels


def add_aromatic_oh_labels(mol, Chem, labels: list[str]) -> list[str]:
    """Heteroaromatic ring-OH only; benzene-OH gets no separate chip."""
    from rdkit.Chem import Fragments

    phenol_pat = Chem.MolFromSmarts("[OH1]c1ccccc1")
    if phenol_pat and mol.HasSubstructMatch(phenol_pat):
        return labels
    if Fragments.fr_Ar_OH(mol) > 0:
        if "Heterocyclic OH" not in labels:
            labels.append("Heterocyclic OH")
    return labels


def sort_fgs_en(labels: list[str]) -> list[str]:
    return sorted(labels, key=lambda name: FG_ORDER.get(name, 999))


def has_ring_n(labels: list[str]) -> bool:
    return bool(RING_N_EN & set(labels))


def ring_n_nn_bond_counts(mol, Chem) -> tuple[int, int]:
    """Count N=N and N–N bonds between ring nitrogens (Kekulé bond order)."""
    if mol is None or Chem is None:
        return 0, 0
    from rdkit.Chem import BondType

    k = Chem.Mol(mol)
    try:
        Chem.Kekulize(k, clearAromaticFlags=True)
    except Exception:
        return 0, 0
    nn_eq = 0
    eq_atoms: set[int] = set()
    for bond in k.GetBonds():
        a1 = bond.GetBeginAtom()
        a2 = bond.GetEndAtom()
        if a1.GetAtomicNum() != 7 or a2.GetAtomicNum() != 7:
            continue
        if not (a1.IsInRing() and a2.IsInRing()):
            continue
        if bond.GetBondType() == BondType.DOUBLE:
            nn_eq += 1
            eq_atoms.update({a1.GetIdx(), a2.GetIdx()})
    nn_single = 0
    for bond in k.GetBonds():
        a1 = bond.GetBeginAtom()
        a2 = bond.GetEndAtom()
        if a1.GetAtomicNum() != 7 or a2.GetAtomicNum() != 7:
            continue
        if not (a1.IsInRing() and a2.IsInRing()):
            continue
        if bond.GetBondType() != BondType.SINGLE:
            continue
        idx = {a1.GetIdx(), a2.GetIdx()}
        if idx & eq_atoms:
            continue
        nn_single += 1
    return nn_eq, nn_single


def append_ring_n_chip(details: list[str], atom_count: int, base: str) -> None:
    if atom_count <= 0:
        return
    details.append(base if atom_count == 1 else f"{atom_count}× {base}")


def ring_n_detail_de(mol, Chem) -> list[str]:
    """Ring-N by binding pattern (alkyl, N=N / N–N, plain, N–H) — not one coarse count."""
    if mol is None or Chem is None:
        return []
    details: list[str] = []
    for key, smarts, base in RING_N_SUBTYPE_PATTERNS:
        if key == "N_ring_alkyl":
            count = count_custom_fg(mol, Chem, smarts)
            append_ring_n_chip(details, count, base)
            nn_eq, nn_single = ring_n_nn_bond_counts(mol, Chem)
            append_ring_n_chip(details, nn_eq, "N mit N=N-Bindung")
            append_ring_n_chip(details, nn_single, "N mit N–N-Bindung")
            continue
        count = count_custom_fg(mol, Chem, smarts)
        append_ring_n_chip(details, count, base)
    return details


_jury_priority_order = {name: i for i, name in enumerate(FG_JURY_PRIORITY)}


def jury_display_labels(
    labels: list[str], ring_detail_de: list[str] | None = None
) -> list[str]:
    """Return up to MAX_JURY_LABELS patterns for the quiz UI."""
    non_ring_n = [label for label in labels if label not in RING_N_EN]
    # Ring ether is more telling than an extra C=C if both are present
    if RING_O_EN & set(non_ring_n) or "Ether" in non_ring_n:
        non_ring_n = [label for label in non_ring_n if label != "Alkene"]
    ranked = sorted(non_ring_n, key=lambda name: _jury_priority_order.get(name, 999))
    other_de = [fg_display_de(label) for label in ranked if fg_display_de(label)]
    combined = list(ring_detail_de or []) + other_de
    if RING_O_AROM_EN in labels and (has_ring_n(labels) or ring_detail_de):
        drop = {
            fg_display_de(RING_O_AROM_EN),
            "N im Ring",
            fg_display_de("Ring N"),
            fg_display_de("Ring N-H"),
        }
        drop.discard(None)
        combined = [RING_NO_COMBINED_DE] + [c for c in combined if c not in drop]
    return combined[:MAX_JURY_LABELS]


FG_INSTEAD_PRIORITY_DE = [
    fg_display_de(name) for name in FG_INSTEAD_PRIORITY if fg_display_de(name)
]
_instead_priority_order = {name: i for i, name in enumerate(FG_INSTEAD_PRIORITY_DE)}
_ALKENE_CHIP = fg_display_de("Alkene")
_RING_O_CHIPS = frozenset(
    c for c in (fg_display_de("Ring O arom"), fg_display_de("Ring O aliph")) if c
)
_ETHER_CHIP = fg_display_de("Ether")


_highlight_exclusive_order = {
    name: i for i, name in enumerate(FG_HIGHLIGHT_EXCLUSIVE_PRIORITY)
}
_highlight_exclusive_order[RING_NO_COMBINED_KEY] = _highlight_exclusive_order.get(
    RING_O_AROM_EN, 5
)


def refine_gt_extra_highlight_en(
    gt_extra_en: list[str],
    all_labels_en: list[list[str]],
    gt_idx: int,
) -> list[str]:
    """Pick 1–2 decisive exclusive reasons for the resolution highlight (not every exclusive FG)."""
    extra = set(sort_fgs_en(gt_extra_en))
    if not extra:
        return []

    if IMINE_EN & extra:
        for i, labels in enumerate(all_labels_en):
            if i != gt_idx and IMINE_EN & set(labels):
                extra -= IMINE_EN
                break

    if RING_O_AROM_EN in extra and RING_N_EN & extra:
        extra -= RING_N_EN
        extra.discard(RING_O_AROM_EN)
        extra.add(RING_NO_COMBINED_KEY)

    ranked = sorted(extra, key=lambda name: _highlight_exclusive_order.get(name, 999))
    if not ranked:
        return []
    if ranked[0] in ("Halogen", "Nitro"):
        return [ranked[0]]
    return ranked[:2]


def gt_extra_highlight_de(highlight_en: list[str]) -> list[str]:
    out: list[str] = []
    for en in highlight_en:
        if en == RING_NO_COMBINED_KEY:
            out.append(RING_NO_COMBINED_DE)
        else:
            de = fg_display_de(en)
            if de:
                out.append(de)
    return out


def pick_instead_labels_de(
    gt_labels_de: list[str],
    all_labels_en: list[list[str]],
    gt_idx: int,
) -> list[str]:
    """Pick distinctive 'Stattdessen' chips — avoid weak Alken if others are heterocycles."""
    others_have_ring_n = any(
        has_ring_n(all_labels_en[i])
        for i in range(len(all_labels_en))
        if i != gt_idx
    )
    filtered = list(gt_labels_de)
    if others_have_ring_n and _ALKENE_CHIP:
        filtered = [label for label in filtered if label != _ALKENE_CHIP]
    if _RING_O_CHIPS and _ETHER_CHIP and any(
        label in filtered for label in (*_RING_O_CHIPS, _ETHER_CHIP)
    ):
        filtered = [label for label in filtered if label != _ALKENE_CHIP]
    ranked = sorted(
        filtered, key=lambda label: _instead_priority_order.get(label, 999)
    )
    return ranked[:2]


def detect_molecule_fgs(smiles: str, Chem) -> tuple[str | None, list[str]]:
    """Return (fg_primary, fg_labels) — human-readable functional group names."""
    mol = Chem.MolFromSmiles(smiles) if Chem else None
    if mol is None:
        return None, []

    from rdkit.Chem import Fragments

    labels: list[str] = []
    for name, fn_name in FG_DETECTORS:
        custom_smarts = FG_CUSTOM_SMARTS.get(name)
        if custom_smarts:
            if match_custom_fg(mol, Chem, custom_smarts):
                labels.append(name)
            elif name in FG_EXTRA_SMARTS:
                for extra in FG_EXTRA_SMARTS[name]:
                    if match_custom_fg(mol, Chem, extra):
                        labels.append(name)
                        break
            continue
        if not fn_name:
            continue
        fn = getattr(Fragments, fn_name, None)
        if fn and fn(mol) > 0:
            labels.append(name)

    labels = refine_fg_labels(labels)
    labels = add_aromatic_oh_labels(mol, Chem, labels)
    labels = sort_fgs_en(labels)

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
        de = fg_display_de(fg)
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
    shared_fgs_de = [
        fg_display_de(f) for f in sort_fgs_en(list(shared_en)) if fg_display_de(f)
    ]

    gt_en = set(all_labels_en[gt_idx]) if gt_idx < len(all_labels_en) else set()
    others = [set(all_labels_en[i]) for i in range(len(all_labels_en)) if i != gt_idx]
    gt_extra_en = [
        fg for fg in gt_en if others and not any(fg in other for other in others)
    ]
    gt_extra_highlight_en = refine_gt_extra_highlight_en(
        gt_extra_en, all_labels_en, gt_idx
    )
    gt_extra_fgs_de = gt_extra_highlight_de(gt_extra_highlight_en)
    gt_labels_de_all = [
        fg_display_de(f) for f in all_labels_en[gt_idx] if fg_display_de(f)
    ] if gt_idx < len(all_labels_en) else []
    gt_instead_fgs_de = pick_instead_labels_de(
        gt_extra_fgs_de or gt_labels_de_all, all_labels_en, gt_idx
    )

    non_gt_shared_en: set[str] = set()
    if others:
        non_gt_shared_en = set.intersection(*others)
    non_gt_shared_fgs_de = [
        fg_display_de(f) for f in sort_fgs_en(list(non_gt_shared_en)) if fg_display_de(f)
    ]
    gt_lacks_en = [fg for fg in non_gt_shared_en if fg not in gt_en]
    gt_lacks_fgs_de = [
        fg_display_de(f) for f in sort_fgs_en(gt_lacks_en) if fg_display_de(f)
    ]

    non_gt_indices = [i for i in range(n) if i != gt_idx]
    non_gt_all_have_ring_n = bool(non_gt_indices) and all(
        has_ring_n(all_labels_en[i]) for i in non_gt_indices
    )
    gt_has_ring_n = has_ring_n(all_labels_en[gt_idx]) if gt_idx < len(all_labels_en) else False
    gt_lacks_coarse_de: list[str] = []
    if non_gt_all_have_ring_n and not gt_has_ring_n:
        gt_lacks_coarse_de = [COARSE_RING_N_DE]

    gt_extra_coarse_de: list[str] = []
    if gt_has_ring_n and non_gt_indices and not any(
        has_ring_n(all_labels_en[i]) for i in non_gt_indices
    ):
        gt_extra_coarse_de = [COARSE_RING_N_DE]

    all_en: set[str] = set()
    for labels in all_labels_en:
        all_en.update(labels)

    return {
        "majority_fg": majority_fg,
        "majority_fg_de": fg_display_de(majority_fg),
        "majority_count": majority_count,
        "other_primaries_de": other_primaries_de,
        "gt_fg": primary_fgs[gt_idx] if gt_idx < n else None,
        "gt_fg_de": fg_display_de(primary_fgs[gt_idx] if gt_idx < n else None),
        "gt_idx": gt_idx,
        "shared_fgs_de": shared_fgs_de,
        "non_gt_shared_fgs_de": non_gt_shared_fgs_de,
        "gt_lacks_fgs_de": gt_lacks_fgs_de,
        "gt_extra_fgs_de": gt_extra_fgs_de,
        "gt_instead_fgs_de": gt_instead_fgs_de,
        "gt_lacks_coarse_de": gt_lacks_coarse_de,
        "gt_extra_coarse_de": gt_extra_coarse_de,
        "coarse_criterion_de": COARSE_RING_N_DE,
        "glossary": {},
        "alt_gt_indices": alt_gt_indices,
        "alt_gt_fgs": alt_gt_fgs,
        "alt_gt_fgs_de": {k: fg_display_de(v) for k, v in alt_gt_fgs.items()},
        "model_pred_idx": model_pred_idx,
        "model_alt_correct": model_alt_correct,
        "model_exclusive_fgs_de": [
            fg_display_de(f) for f in sort_fgs_en(list(model_excl_en)) if fg_display_de(f)
        ],
        "model_lacks_fgs_de": [
            fg_display_de(f) for f in sort_fgs_en(list(model_lacks_en)) if fg_display_de(f)
        ],
        "model_without_n_fg": model_without_n,
        "source": "rdkit",
    }


def enrich_functional_groups(data: dict, Chem) -> dict:
    """Add formula, FG labels (DE), and fg_analysis at set level."""
    primary_fgs: list[str | None] = []
    all_labels_en: list[list[str]] = []
    for mol in data["molecules"]:
        primary, labels_full = detect_molecule_fgs(mol["smiles"], Chem)
        mol_obj = Chem.MolFromSmiles(mol["smiles"]) if Chem else None
        ring_detail = ring_n_detail_de(mol_obj, Chem) if mol_obj else []
        labels_display = jury_display_labels(labels_full, ring_detail)
        mol["fg_primary"] = primary
        mol["fg_labels"] = labels_display
        mol["fg_labels_full"] = labels_full
        mol["fg_ring_n_detail_de"] = ring_detail
        mol["fg_primary_de"] = fg_display_de(primary)
        mol["fg_labels_de"] = labels_display
        mol["mol_formula"] = mol_formula_from_smiles(mol["smiles"], Chem)
        primary_fgs.append(primary)
        all_labels_en.append(labels_full)

    data["fg_analysis"] = compute_fg_analysis(data, primary_fgs, all_labels_en)
    all_en: set[str] = set()
    for labels in all_labels_en:
        all_en.update(labels)
    ring_chips: list[str] = []
    for mol in data["molecules"]:
        ring_chips.extend(mol.get("fg_ring_n_detail_de") or [])
    glossary = build_set_glossary(all_en, ring_chips)
    augment_glossary_from_display_labels(glossary, data["molecules"])
    data["fg_analysis"]["glossary"] = glossary
    return data


def backfill_pea_from_scaffold_twin(data: dict) -> dict:
    """Random-strategy sets share SMILES with scaffold_similar twins but often lack PEA aggregates."""
    if data.get("pea_matrix_mean"):
        return data
    if data.get("strategy") != "random":
        return data

    twin_path = DATEN / f"inference_scaffold_similar_set{data['set_idx']}.json"
    if not twin_path.is_file():
        return data

    twin = json.loads(twin_path.read_text(encoding="utf-8"))
    if not twin.get("pea_matrix_mean"):
        return data

    src_smiles = [mol["smiles"] for mol in data["molecules"]]
    twin_smiles = [mol["smiles"] for mol in twin["molecules"]]
    if src_smiles != twin_smiles:
        return data

    data["pea_matrix_mean"] = twin["pea_matrix_mean"]
    if twin.get("pea_matrix_std"):
        data["pea_matrix_std"] = twin["pea_matrix_std"]
    return data


def collect_inference_files() -> list[Path]:
    files = sorted(DATEN.glob(INFERENCE_GLOB))
    return [f for f in files if f.name.count("_set") == 1]


def generate_tutorial_pngs(Chem) -> int:
    """Two-molecule comparison images for the FG tutorial popup."""
    if Chem is None:
        return 0
    count = 0
    for pair in TUTORIAL_PAIRS:
        pair_id = pair["id"]
        smiles_list = pair["smiles"]
        paths = [GALLERY / f"tutorial_{pair_id}_mol{i}.png" for i in range(len(smiles_list))]
        render_smiles_batch(
            smiles_list, paths, list(range(len(smiles_list))), Chem, fixed_bond_length=PNG_TUTORIAL_BOND_LEN
        )
        count += len(smiles_list)
    return count


def generate_gallery(inference_files: list[Path]) -> dict:
    Chem, Draw = try_rdkit()
    stats = {"rdkit": 0, "placeholder": 0, "sets": 0, "images": 0}
    GALLERY.mkdir(parents=True, exist_ok=True)

    for json_path in inference_files:
        data = json.loads(json_path.read_text(encoding="utf-8"))
        strategy = data["strategy"]
        set_idx = data["set_idx"]
        stats["sets"] += 1

        smiles_list = [mol["smiles"] for mol in data["molecules"]]
        paths: list[Path] = []
        for mol_idx in range(len(smiles_list)):
            png_name = f"{strategy}_set{set_idx}_mol{mol_idx}.png"
            paths.append(GALLERY / png_name)

        if Chem is not None:
            methods = render_smiles_batch(
                smiles_list, paths, list(range(len(smiles_list))), Chem
            )
        else:
            methods = []
            for mol_idx, (smiles, path) in enumerate(zip(smiles_list, paths)):
                placeholder_png(path, smiles, mol_idx)
                methods.append("placeholder")

        for method in methods:
            stats[method] += 1
            stats["images"] += 1

    tutorial_count = generate_tutorial_pngs(Chem)
    if tutorial_count:
        stats["images"] += tutorial_count
        stats["rdkit"] += tutorial_count

    fg_ref_count = generate_fg_reference_pngs(Chem)
    if fg_ref_count:
        stats["images"] += fg_ref_count
        stats["rdkit"] += fg_ref_count

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
    manifest: dict[str, list[int]] = {}
    for json_path in inference_files:
        data = json.loads(json_path.read_text(encoding="utf-8"))
        data = backfill_pea_from_scaffold_twin(data)
        if Chem is not None:
            data = enrich_functional_groups(data, Chem)
        strategy = data["strategy"]
        set_idx = data["set_idx"]
        if strategy in ("scaffold_similar", "random"):
            manifest.setdefault(strategy, []).append(set_idx)
        for mol_idx in range(len(data["molecules"])):
            needed.add(f"{strategy}_set{set_idx}_mol{mol_idx}.png")
        (data_dir / json_path.name).write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    for indices in manifest.values():
        indices.sort()
    (data_dir / "set_manifest.json").write_text(
        json.dumps({"strategies": manifest}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # Gallery PNGs
    gallery_dst = target / "gallery"
    gallery_dst.mkdir(parents=True, exist_ok=True)

    for png_name in sorted(needed):
        src = GALLERY / png_name
        if src.exists():
            shutil.copy2(src, gallery_dst / png_name)

    for pair in TUTORIAL_PAIRS:
        for i in range(len(pair["smiles"])):
            src = GALLERY / f"tutorial_{pair['id']}_mol{i}.png"
            if src.exists():
                shutil.copy2(src, gallery_dst / src.name)

    fg_ref_src = GALLERY / FG_REF_DIR
    if fg_ref_src.is_dir():
        fg_ref_dst = gallery_dst / FG_REF_DIR
        fg_ref_dst.mkdir(parents=True, exist_ok=True)
        for png in sorted(fg_ref_src.glob("*.png")):
            shutil.copy2(png, fg_ref_dst / png.name)

    if (GALLERY / "set_index.json").exists():
        shutil.copy2(GALLERY / "set_index.json", gallery_dst / "set_index.json")

    # GitHub Pages: Jekyll deaktivieren (sonst Probleme mit data/, js/, etc.)
    (target / ".nojekyll").touch()


def sanitize_public_pages(target: Path) -> None:
    """Remove dev-only tooling from the public GitHub Pages bundle (docs/ only)."""
    index = target / "index.html"
    html = index.read_text(encoding="utf-8")
    html = re.sub(
        r"\n\s*<section id=\"screen-curator\".*?</section>\n",
        "\n",
        html,
        flags=re.DOTALL,
    )
    html = html.replace('  <script type="module" src="js/curator.js"></script>\n', "")
    index.write_text(html, encoding="utf-8")

    (target / "js" / "curator.js").write_text(
        "/** Public Pages — Kurator deaktiviert. */\n"
        "export async function ensureCuratorReady() {}\n"
        "export async function showCuratorScreen() {}\n",
        encoding="utf-8",
    )

    loader = target / "js" / "data-loader.js"
    loader.write_text(
        loader.read_text(encoding="utf-8").replace(
            'return new URLSearchParams(window.location.search).get("mode") === "curator";',
            "return false;",
        ),
        encoding="utf-8",
    )

    app = target / "js" / "app.js"
    app_text = app.read_text(encoding="utf-8")
    app_text = app_text.replace("  initCuratorEntry();\n", "")
    app_text = re.sub(
        r"\n  if \(isCuratorMode\(\)\) \{.*?\n  \}\n",
        "\n",
        app_text,
        count=1,
        flags=re.DOTALL,
    )
    app.write_text(app_text, encoding="utf-8")


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
    sanitize_public_pages(DOCS)
    print("  docs/: Kurator und Dev-Dateien für Pages entfernt")

    print("Fertig.")
    print(f"  dist/:  {DIST}")
    print(f"  docs/:  {DOCS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
