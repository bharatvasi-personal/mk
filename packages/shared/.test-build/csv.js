"use strict";
/**
 * A small, strict CSV reader and writer.
 *
 * No dependency, because the alternative pulls in a parser with a dozen dialect options
 * to read files that a shop owner exported from Excel or typed in Google Sheets. What
 * those files actually need is narrow and knowable: quoted fields, embedded commas,
 * doubled quotes, CRLF from Windows, and a BOM that Excel adds without telling anyone.
 * That is this file.
 *
 * It is in `shared` so the browser can preview a file with exactly the same rules the
 * server will apply to it. A preview that disagrees with the import is worse than none.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCsvLines = parseCsvLines;
exports.parseCsv = parseCsv;
exports.toCsv = toCsv;
exports.csvBool = csvBool;
exports.csvMoneyMinor = csvMoneyMinor;
exports.csvNumber = csvNumber;
exports.csvDate = csvDate;
exports.csvEnum = csvEnum;
/**
 * Splits CSV text into rows of raw cells. Handles quoted fields containing commas,
 * newlines and doubled quotes.
 */
function parseCsvLines(text) {
    // Excel writes a UTF-8 BOM. Left in place it becomes part of the first header name,
    // and then "sku" silently never matches.
    const input = text.replace(/^﻿/, '');
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < input.length; i += 1) {
        const char = input[i];
        if (inQuotes) {
            if (char === '"') {
                if (input[i + 1] === '"') {
                    field += '"';
                    i += 1;
                }
                else {
                    inQuotes = false;
                }
            }
            else {
                field += char;
            }
            continue;
        }
        if (char === '"') {
            inQuotes = true;
        }
        else if (char === ',') {
            row.push(field);
            field = '';
        }
        else if (char === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        }
        else if (char === '\r') {
            // Swallowed; the \n that follows ends the row.
        }
        else {
            field += char;
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    // Trailing newlines produce a final empty row that means nothing.
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
/**
 * Parses CSV into objects keyed by header.
 *
 * Header matching is case-insensitive and ignores spaces and underscores, because
 * "Reorder Point", "reorder_point" and "reorderPoint" are the same column to everyone
 * except a computer, and rejecting a file over that wastes someone's morning.
 */
function parseCsv(text, spec) {
    const lines = parseCsvLines(text);
    if (lines.length === 0) {
        return { headers: [], rows: [], unknownHeaders: [], missingHeaders: spec.required };
    }
    const known = [...spec.required, ...(spec.optional ?? [])];
    const canonical = new Map(known.map((k) => [normalise(k), k]));
    const rawHeaders = lines[0].map((h) => h.trim());
    const headers = rawHeaders.map((h) => canonical.get(normalise(h)) ?? h);
    const unknownHeaders = rawHeaders.filter((h) => !canonical.has(normalise(h)));
    const missingHeaders = spec.required.filter((r) => !headers.includes(r));
    const rows = [];
    for (const line of lines.slice(1)) {
        const row = {};
        headers.forEach((header, index) => {
            row[header] = (line[index] ?? '').trim();
        });
        rows.push(row);
    }
    return { headers, rows, unknownHeaders, missingHeaders };
}
function normalise(header) {
    return header.toLowerCase().replace(/[\s_-]+/g, '');
}
/** Serialises rows back to CSV — used for the downloadable templates. */
function toCsv(headers, rows) {
    const escape = (value) => {
        const s = value === null || value === undefined ? '' : String(value);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
}
// ─── Cell coercion ───────────────────────────────────────────────────────────
// Spreadsheets are typeless. These turn what a person actually types into what the
// database needs, and say so plainly when they cannot.
function csvBool(value, fallback = false) {
    if (value === undefined || value.trim() === '')
        return fallback;
    return ['1', 'true', 'yes', 'y', 'haan', 'हाँ'].includes(value.trim().toLowerCase());
}
/** Money as typed — "120", "120.50", "₹120.50", "1,200" — into integer paise. */
function csvMoneyMinor(value) {
    if (!value || !value.trim())
        return null;
    const cleaned = value.replace(/[₹,\s]/g, '');
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0)
        return null;
    return Math.round(n * 100);
}
function csvNumber(value) {
    if (!value || !value.trim())
        return null;
    const n = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
}
/** Accepts YYYY-MM-DD and the DD/MM/YYYY that Indian spreadsheets default to. */
function csvDate(value) {
    if (!value || !value.trim())
        return null;
    const v = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v))
        return v;
    const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(v);
    if (dmy) {
        const [, d, m, y] = dmy;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return null;
}
/** Enum values, matched loosely: "less oil", "LESS_OIL" and "Less-Oil" all land. */
function csvEnum(value, allowed) {
    if (!value || !value.trim())
        return null;
    const n = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return allowed.find((a) => a.toLowerCase() === n) ?? null;
}
