/**
 * sheets-formatter.gs
 *
 * Formats a sheet of exported reel data (from Moody's AI's
 * Videos page "Export" button) into a clean, minimalist-luxury layout:
 * styled frozen header, muted alternating row banding, auto-sized
 * columns with fixed/wrapped widths for the long text columns, and
 * clickable links in the Link column.
 *
 * Data rows are held to a fixed max height — long Analysis/Concepts/
 * Transcript text still wraps within the cell, but simply gets visually
 * clipped at that height rather than stretching the row. Click into a
 * cell (or expand the formula bar) to read the full text.
 *
 * SETUP
 * 1. Import the exported CSV into a Google Sheet (File > Import).
 * 2. Extensions > Apps Script, paste this whole file in, save.
 * 3. Reload the Sheet — a "✨ Format Sheet" menu appears. Click it.
 *    (Or, from the Apps Script editor, select the `formatSheet`
 *    function and click Run.)
 *
 * Safe to re-run after re-importing a fresh export — it doesn't touch
 * the underlying data, only formatting, and clears its own previous
 * banding before reapplying so it won't error on a second run.
 */

// Column headers this script knows how to treat specially. Everything
// else just gets the header style + banding + auto-sized width.
const WRAP_COLUMNS = ["Hook", "Analysis", "Concepts", "Transcript"];
const WRAP_COLUMN_WIDTH = 320;
const LINK_COLUMN = "Link";

const HEADER_BG = "#1E1E1C"; // near-black charcoal
const HEADER_FG = "#F5F1E8"; // warm off-white
const HEADER_FONT = "Georgia";
const HEADER_ROW_HEIGHT = 34;
const BODY_ROW_HEIGHT = 28; // rows with no wrapped text (set by banding, overridden below for data rows)
const MAX_ROW_HEIGHT = 120; // fixed cap for all data rows — wrapped text clips here instead of stretching

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("✨ Format Sheet")
    .addItem("Apply formatting", "formatSheet")
    .addToUi();
}

function formatSheet() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return; // empty sheet, nothing to do

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const colIndex = (name) => {
    const i = headers.findIndex(
      (h) => String(h).trim().toLowerCase() === name.toLowerCase()
    );
    return i === -1 ? -1 : i + 1; // 1-based
  };

  styleHeader_(sheet, lastCol);
  sheet.setFrozenRows(1);

  if (lastRow > 1) {
    applyBanding_(sheet, lastRow, lastCol);
    linkifyColumn_(sheet, colIndex(LINK_COLUMN), lastRow);
  }

  autoSizeColumns_(sheet, lastCol);
  wrapLongColumns_(sheet, headers, colIndex, lastRow);

  SpreadsheetApp.flush();
}

function styleHeader_(sheet, lastCol) {
  const header = sheet.getRange(1, 1, 1, lastCol);
  header
    .setBackground(HEADER_BG)
    .setFontColor(HEADER_FG)
    .setFontWeight("bold")
    .setFontFamily(HEADER_FONT)
    .setFontSize(11)
    .setVerticalAlignment("middle")
    .setHorizontalAlignment("left");
  sheet.setRowHeight(1, HEADER_ROW_HEIGHT);
}

function applyBanding_(sheet, lastRow, lastCol) {
  const dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);

  // Clear any banding already on this range so re-running doesn't error.
  dataRange.getBandings().forEach((b) => b.remove());

  dataRange.applyRowBanding(
    SpreadsheetApp.BandingTheme.LIGHT_GREY,
    /* showHeader */ false,
    /* showFooter */ false
  );

  sheet.setRowHeights(2, lastRow - 1, BODY_ROW_HEIGHT);
}

function autoSizeColumns_(sheet, lastCol) {
  sheet.autoResizeColumns(1, lastCol);
}

function wrapLongColumns_(sheet, headers, colIndex, lastRow) {
  if (lastRow < 2) return;

  WRAP_COLUMNS.forEach((name) => {
    const col = colIndex(name);
    if (col === -1) return;

    sheet.setColumnWidth(col, WRAP_COLUMN_WIDTH);

    const range = sheet.getRange(1, col, lastRow, 1);
    range.setWrap(true).setVerticalAlignment("top");
  });

  // Fixed cap, not auto-height — long text still wraps inside the cell,
  // it just clips at this height instead of stretching every row to fit
  // the longest Analysis/Concepts/Transcript entry. Full text is still
  // there; click the cell to read it.
  sheet.setRowHeights(2, lastRow - 1, MAX_ROW_HEIGHT);
}

function linkifyColumn_(sheet, col, lastRow) {
  if (col === -1 || lastRow < 2) return;

  const range = sheet.getRange(2, col, lastRow - 1, 1);
  const values = range.getValues();

  const richValues = values.map(([url]) => {
    const text = String(url || "").trim();
    if (!text) return [SpreadsheetApp.newRichTextValue().setText("").build()];
    return [
      SpreadsheetApp.newRichTextValue().setText(text).setLinkUrl(text).build(),
    ];
  });

  range.setRichTextValues(richValues);
}
