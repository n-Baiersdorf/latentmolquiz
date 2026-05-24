/**
 * PEA panel: summary + monochrome 4×4 matrix (always visible after resolution).
 */

import { computeOffDiagonalRange } from "./data-loader.js";

function molTag(idx) {
  return `#${idx + 1}`;
}

function rowDominantSources(matrix) {
  const n = matrix.length;
  const map = new Map();
  for (let i = 0; i < n; i++) {
    let maxJ = -1;
    let maxV = -1;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (matrix[i][j] > maxV) {
        maxV = matrix[i][j];
        maxJ = j;
      }
    }
    if (maxJ >= 0) map.set(i, maxJ);
  }
  return map;
}

function renderHeatmapTable(matrix, options) {
  const { gtIdx, wrongPredCols = [] } = options;
  const n = matrix.length;
  const wrongSet = new Set(wrongPredCols);
  const rowMaxCol = rowDominantSources(matrix);
  const table = document.createElement("table");
  table.className = "pea-table pea-heatmap-table";

  const headerRow = document.createElement("tr");
  headerRow.innerHTML = "<th class='pea-corner'>Ziel \\ Quelle</th>";
  for (let j = 0; j < n; j++) {
    const th = document.createElement("th");
    th.textContent = molTag(j);
    if (j === gtIdx) th.classList.add("pea-gt-axis");
    if (wrongSet.has(j)) th.classList.add("pea-wrong-col");
    headerRow.appendChild(th);
  }
  table.appendChild(headerRow);

  for (let i = 0; i < n; i++) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = molTag(i);
    if (i === gtIdx) th.classList.add("pea-gt-axis");
    tr.appendChild(th);

    for (let j = 0; j < n; j++) {
      const td = document.createElement("td");
      const val = matrix[i][j];
      const isDiag = i === j;
      td.textContent = val.toFixed(2);
      td.className = "pea-cell";
      if (isDiag) td.classList.add("pea-diagonal");
      if (i === gtIdx || j === gtIdx) td.classList.add("pea-gt-cell");
      if (wrongSet.has(j)) td.classList.add("pea-wrong-col");
      if (!isDiag && rowMaxCol.get(i) === j) td.classList.add("pea-row-max");
      td.title = `${molTag(j)} → ${molTag(i)}: ${val.toFixed(2)}`;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  return table;
}

export function renderPeaHeatmap(container, matrix, options = {}) {
  const { gtIdx = 0, wrongPredCols = [] } = options;
  container.innerHTML = "";

  if (!matrix?.length) {
    container.innerHTML = "<p class='pea-missing'>PEA-Daten nicht verfügbar.</p>";
    return { setHighlight: () => {}, clearHighlight: () => {} };
  }

  computeOffDiagonalRange(matrix);

  const block = document.createElement("div");
  block.className = "pea";

  block.innerHTML = `
    <div class="pea-head">
      <p class="pea-title">PEA-Matrix</p>
      <p class="pea-subtitle">Perspective Ensemble Attention</p>
    </div>
    <p class="pea-teaser">Die Matrix zeigt, wie das Modell entscheidet, die vier Moleküle miteinander zu vermischen.</p>
    <details class="pea-more">
      <summary class="info-btn">ⓘ Weitere Informationen</summary>
      <div class="pea-more-body">
        <p><strong>Zeile</strong> = Ziel-Molekül · <strong>Spalte</strong> = Quellen-Molekül. Jede Zelle: Anteil, mit dem die Quelle in die Ziel-Darstellung einfließt (Mittel über 5 Modell-Seeds).</p>
        <ul class="detail-legend-list">
          <li><strong>Rahmen</strong> — Zeile/Spalte des Ausreißers (definierte Ground Truth)</li>
          <li><strong>Unterstrichen</strong> — stärkste Quelle in dieser Zeile (ohne Diagonale)</li>
          <li><strong>Grau</strong> — Diagonale = 1 (Selbstanteil)</li>
          <li><strong>Gestrichelte Spalte</strong> — mindestens ein Seed wählte dieses Molekül fälschlich als Ausreißer</li>
        </ul>
      </div>
    </details>`;

  const matrixWrap = document.createElement("div");
  matrixWrap.className = "pea-matrix";
  matrixWrap.appendChild(renderHeatmapTable(matrix, { gtIdx, wrongPredCols }));
  block.appendChild(matrixWrap);

  container.appendChild(block);
  return { setHighlight: () => {}, clearHighlight: () => {} };
}

export function bindMoleculePeaHighlight() {}
