// Data layer. Default backend = localStorage (offline-first PWA).
// Optional Supabase sync: set url+key in Settings; supabase.js adapter takes over.
// Every method is async so the two backends share one interface.

const LS_KEY = "budgetapp_v1";
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2) + Date.now());

function nowISO() { return new Date().toISOString(); }
function monthOf(dateISO) { return String(dateISO).slice(0, 7); } // YYYY-MM

const LocalStore = {
  _data: null,

  _load() {
    if (this._data) return this._data;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) { this._data = JSON.parse(raw); return this._data; }
    } catch (e) { /* fall through to empty */ }
    this._data = { categories: [], transactions: [], budgets: [], settings: {} };
    return this._data;
  },

  _save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this._data)); } catch (e) { console.warn("save failed", e); }
  },

  async isSeeded() { return this._load().categories.length > 0; },

  async seed(seed) {
    const d = this._load();
    const catByName = {};
    d.categories = seed.categories.map((c) => {
      const cat = { id: uid(), name: c.name, keywords: c.keywords || [] };
      catByName[c.name] = cat.id;
      return cat;
    });
    d.budgets = (seed.budgets || []).map((b) => ({
      id: uid(), category_id: catByName[b.category] || null, month: b.month, amount_aud: b.amount,
    })).filter((b) => b.category_id);
    d.transactions = (seed.transactions || []).map((t) => ({
      id: uid(), date: t.date, category_id: catByName[t.category] || catByName["Other"] || null,
      amount: t.amount, currency: t.currency, amount_aud: t.amount_aud,
      notes: t.notes || "", payment: t.payment || "", created_at: nowISO(),
    }));
    d.settings = {};
    (seed.settings || []).forEach((s) => { d.settings[s.key] = s.value; });
    this._save();
  },

  // --- categories ---
  async getCategories() { return this._load().categories.slice(); },
  async addCategory(name, keywords) {
    const d = this._load();
    const cat = { id: uid(), name, keywords: keywords || [] };
    d.categories.push(cat); this._save(); return cat;
  },
  async updateCategory(id, patch) {
    const d = this._load();
    const c = d.categories.find((x) => x.id === id);
    if (c) Object.assign(c, patch); this._save(); return c;
  },
  async deleteCategory(id) {
    const d = this._load();
    let other = d.categories.find((c) => c.name === "Other");
    if (!other) { other = { id: uid(), name: "Other", keywords: [] }; d.categories.push(other); }
    if (other.id === id) return; // never delete Other
    d.transactions.forEach((t) => { if (t.category_id === id) t.category_id = other.id; });
    d.budgets = d.budgets.filter((b) => b.category_id !== id);
    d.categories = d.categories.filter((c) => c.id !== id);
    this._save();
  },

  // --- transactions ---
  async getTransactions() {
    return this._load().transactions.slice().sort((a, b) =>
      (b.date + b.created_at).localeCompare(a.date + a.created_at));
  },
  async addTransaction(t) {
    const d = this._load();
    const row = { id: uid(), created_at: nowISO(), ...t };
    d.transactions.push(row); this._save(); return row;
  },
  async updateTransaction(id, patch) {
    const d = this._load();
    const t = d.transactions.find((x) => x.id === id);
    if (t) Object.assign(t, patch); this._save(); return t;
  },
  async deleteTransaction(id) {
    const d = this._load();
    d.transactions = d.transactions.filter((t) => t.id !== id); this._save();
  },

  // --- budgets ---
  async getBudgets(month) {
    const b = this._load().budgets.slice();
    return month ? b.filter((x) => x.month === month) : b;
  },
  async setBudget(category_id, month, amount_aud) {
    const d = this._load();
    let b = d.budgets.find((x) => x.category_id === category_id && x.month === month);
    if (amount_aud === null || amount_aud === "" || isNaN(amount_aud)) {
      if (b) d.budgets = d.budgets.filter((x) => x !== b);
    } else if (b) { b.amount_aud = +amount_aud; }
    else { d.budgets.push({ id: uid(), category_id, month, amount_aud: +amount_aud }); }
    this._save();
  },

  // --- settings ---
  async getSettings() { return { ...this._load().settings }; },
  async setSetting(key, value) { const d = this._load(); d.settings[key] = value; this._save(); },
};

// Public facade. Backend is chosen at init; Supabase adapter swaps in via setBackend().
let DB = LocalStore;
function setBackend(store) { DB = store; }

// Device-local config (never synced): Supabase credentials + passcode live here so
// the app can decide which backend to use before any data call.
const Config = {
  KEY: "budgetapp_config",
  all() { try { return JSON.parse(localStorage.getItem(this.KEY) || "{}"); } catch (e) { return {}; } },
  get(k) { return this.all()[k]; },
  set(k, v) {
    const c = this.all();
    if (v === null || v === undefined || v === "") delete c[k]; else c[k] = v;
    try { localStorage.setItem(this.KEY, JSON.stringify(c)); } catch (e) { /* ignore */ }
  },
};

const Helpers = { uid, monthOf, nowISO };

if (typeof module !== "undefined" && module.exports) module.exports = { LocalStore, Helpers, Config };
