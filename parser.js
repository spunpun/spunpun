// Rule-based sentence parser. Pure functions, no DOM — testable in isolation.
// parseSentence(text, categories, todayISO) -> { amount, currency, date, categoryName, notes, matchedCategory }

const CURRENCY_TOKENS = {
  aud: "AUD", "a$": "AUD", "$": "AUD", dollar: "AUD", dollars: "AUD",
  thb: "THB", baht: "THB", "บาท": "THB", "฿": "THB",
  usd: "USD", "us$": "USD",
  eur: "EUR", "€": "EUR", gbp: "GBP", "£": "GBP",
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function pad(n) { return String(n).padStart(2, "0"); }
function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// --- Date extraction. Returns { iso, consumed:[lowercased tokens to strip] } ---
function extractDate(text, today) {
  const lower = text.toLowerCase();
  const base = today ? new Date(today + "T00:00:00") : new Date();

  // today / yesterday / tomorrow
  if (/\btoday\b/.test(lower)) return { iso: toISO(base), consumed: ["today"] };
  if (/\byesterday\b/.test(lower)) {
    const d = new Date(base); d.setDate(d.getDate() - 1);
    return { iso: toISO(d), consumed: ["yesterday"] };
  }
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(base); d.setDate(d.getDate() + 1);
    return { iso: toISO(d), consumed: ["tomorrow"] };
  }

  // weekday name -> most recent past occurrence (incl. today)
  for (let i = 0; i < WEEKDAYS.length; i++) {
    const re = new RegExp("\\b" + WEEKDAYS[i] + "\\b");
    if (re.test(lower)) {
      const d = new Date(base);
      let diff = (d.getDay() - i + 7) % 7;
      d.setDate(d.getDate() - diff);
      return { iso: toISO(d), consumed: [WEEKDAYS[i]] };
    }
  }

  // "aug 20" or "20 aug" (optional year)
  let m = lower.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b(?:\s+(\d{4}))?/);
  if (m) {
    const day = +m[1], mon = MONTHS.indexOf(m[2]);
    const year = m[3] ? +m[3] : base.getFullYear();
    return { iso: toISO(new Date(year, mon, day)), consumed: [m[0]] };
  }
  m = lower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b(?:,?\s+(\d{4}))?/);
  if (m) {
    const mon = MONTHS.indexOf(m[1]), day = +m[2];
    const year = m[3] ? +m[3] : base.getFullYear();
    return { iso: toISO(new Date(year, mon, day)), consumed: [m[0]] };
  }

  // numeric dates: 20/8, 20/08/2026, 20-8
  m = lower.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (m) {
    const day = +m[1], mon = +m[2] - 1;
    let year = base.getFullYear();
    if (m[3]) year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (mon >= 0 && mon <= 11 && day >= 1 && day <= 31) {
      return { iso: toISO(new Date(year, mon, day)), consumed: [m[0]] };
    }
  }

  return { iso: toISO(base), consumed: [] };
}

// --- Amount + currency. Returns { amount, currency, consumed:[strings] } ---
function extractAmount(text) {
  const lower = text.toLowerCase();
  // symbol-prefixed: $5, ฿120, £3
  let m = lower.match(/([$฿€£])\s?(\d+(?:[.,]\d+)?)/);
  if (m) {
    return { amount: parseFloat(m[2].replace(",", ".")), currency: CURRENCY_TOKENS[m[1]] || "AUD", consumed: [m[0]] };
  }
  // number followed by currency word: "5 aud", "120 thb", "5aud"
  m = lower.match(/\b(\d+(?:[.,]\d+)?)\s?(aud|thb|usd|eur|gbp|baht|บาท|dollars?)\b/);
  if (m) {
    return { amount: parseFloat(m[1].replace(",", ".")), currency: CURRENCY_TOKENS[m[2]] || "AUD", consumed: [m[0]] };
  }
  // currency word followed by number: "aud 5", "thb 120"
  m = lower.match(/\b(aud|thb|usd|eur|gbp|baht|บาท)\s?(\d+(?:[.,]\d+)?)\b/);
  if (m) {
    return { amount: parseFloat(m[2].replace(",", ".")), currency: CURRENCY_TOKENS[m[1]] || "AUD", consumed: [m[0]] };
  }
  // bare number -> default AUD
  m = lower.match(/\b(\d+(?:[.,]\d+)?)\b/);
  if (m) {
    return { amount: parseFloat(m[1].replace(",", ".")), currency: "AUD", consumed: [m[1]] };
  }
  return { amount: null, currency: "AUD", consumed: [] };
}

// --- Category by keyword dictionary. Returns { name, matched } ---
function extractCategory(text, categories) {
  const lower = " " + text.toLowerCase() + " ";
  let best = null;
  for (const cat of categories) {
    for (const kw of (cat.keywords || [])) {
      const k = String(kw).toLowerCase().trim();
      if (!k) continue;
      // word-boundary-ish match, allowing multi-word keywords
      const idx = lower.indexOf(k);
      if (idx !== -1) {
        const before = lower[idx - 1], after = lower[idx + k.length];
        const boundOk = /[^a-z0-9]/.test(before) && /[^a-z0-9]/.test(after);
        if (boundOk && (!best || k.length > best.kw.length)) {
          best = { name: cat.name, kw: k };
        }
      }
    }
  }
  if (best) return { name: best.name, matched: true, keyword: best.kw };
  return { name: "Other", matched: false, keyword: null };
}

function stripAll(text, chunks) {
  let out = " " + text + " ";
  for (const c of chunks) {
    if (!c) continue;
    const re = new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
    out = out.replace(re, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

function parseSentence(text, categories, todayISO) {
  const amt = extractAmount(text);
  const dt = extractDate(text, todayISO);
  const cat = extractCategory(text, categories);

  // Notes = leftover after removing amount/date tokens (keep category words as notes context)
  const consumed = [...amt.consumed, ...dt.consumed];
  let notes = stripAll(text, consumed);
  // tidy leading/trailing currency words that slipped through
  notes = notes.replace(/\b(aud|thb|usd|eur|gbp|baht)\b/ig, "").replace(/\s+/g, " ").trim();

  return {
    amount: amt.amount,
    currency: amt.currency,
    date: dt.iso,
    categoryName: cat.name,
    matchedCategory: cat.matched,
    matchedKeyword: cat.keyword,
    notes,
  };
}

// Split a blob into separate expenses. Boundaries: newline, comma, semicolon,
// "and", "&", "plus". A boundary only starts a NEW expense if the segment carries
// its own amount — so "5 coffee and cake" stays one, "5 coffee and 10 lunch" splits.
function splitExpenses(text) {
  const parts = String(text || "").split(/[\n,;&]|\band\b|\bplus\b/gi).map((s) => s.trim()).filter(Boolean);
  const groups = [];
  for (const p of parts) {
    const hasNum = /\d/.test(p);
    const last = groups[groups.length - 1];
    if (!groups.length) groups.push(p);
    else if (hasNum && /\d/.test(last)) groups.push(p);   // both have amounts -> separate expenses
    else groups[groups.length - 1] = last + " " + p;      // continuation of the previous one
  }
  return groups;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseSentence, extractAmount, extractDate, extractCategory, splitExpenses };
}
