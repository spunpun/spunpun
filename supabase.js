// Supabase backend — mirrors the LocalStore interface in store.js.
// Activated from Settings when a Project URL + anon key are saved.
// Loads @supabase/supabase-js (UMD) from CDN on demand.

async function loadSupabaseLib() {
  if (window.supabase && window.supabase.createClient) return;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load Supabase library"));
    document.head.appendChild(s);
  });
}

function makeSupabaseStore(sb) {
  const q = async (builder) => {
    const { data, error } = await builder;
    if (error) throw error;
    return data;
  };

  return {
    _supabase: true,

    async isSeeded() {
      const rows = await q(sb.from("categories").select("id"));
      return rows.length > 0;
    },

    // Only used if the tables are empty (e.g. schema.sql not run). Mirrors seed.data.json.
    async seed(seed) {
      const cats = await q(sb.from("categories").insert(
        seed.categories.map((c) => ({ name: c.name, keywords: c.keywords || [] }))
      ).select());
      const byName = {};
      cats.forEach((c) => { byName[c.name] = c.id; });
      if (seed.budgets && seed.budgets.length) {
        await q(sb.from("budgets").insert(seed.budgets
          .filter((b) => byName[b.category])
          .map((b) => ({ category_id: byName[b.category], month: b.month, amount_aud: b.amount }))));
      }
      if (seed.transactions && seed.transactions.length) {
        await q(sb.from("transactions").insert(seed.transactions.map((t) => ({
          date: t.date, category_id: byName[t.category] || byName["Other"] || null,
          amount: t.amount, currency: t.currency, amount_aud: t.amount_aud,
          notes: t.notes || "", payment: t.payment || null,
        }))));
      }
      if (seed.settings) {
        await q(sb.from("settings").upsert(seed.settings.map((s) => ({ key: s.key, value: s.value })), { onConflict: "key" }));
      }
    },

    // --- categories ---
    async getCategories() {
      return q(sb.from("categories").select("*").order("name"));
    },
    async addCategory(name, keywords) {
      return q(sb.from("categories").insert({ name, keywords: keywords || [] }).select().single());
    },
    async updateCategory(id, patch) {
      return q(sb.from("categories").update(patch).eq("id", id).select().single());
    },
    async deleteCategory(id) {
      const others = await q(sb.from("categories").select("id").eq("name", "Other").limit(1));
      const otherId = others[0] && others[0].id;
      if (otherId === id) return; // never delete Other
      if (otherId) await q(sb.from("transactions").update({ category_id: otherId }).eq("category_id", id));
      await q(sb.from("categories").delete().eq("id", id)); // budgets cascade via FK
    },

    // --- transactions ---
    async getTransactions() {
      return q(sb.from("transactions").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }));
    },
    async addTransaction(t) {
      return q(sb.from("transactions").insert(t).select().single());
    },
    async updateTransaction(id, patch) {
      return q(sb.from("transactions").update(patch).eq("id", id).select().single());
    },
    async deleteTransaction(id) {
      await q(sb.from("transactions").delete().eq("id", id));
    },

    // --- budgets ---
    async getBudgets(month) {
      let builder = sb.from("budgets").select("*");
      if (month) builder = builder.eq("month", month);
      return q(builder);
    },
    async setBudget(category_id, month, amount_aud) {
      if (amount_aud === null || amount_aud === "" || isNaN(amount_aud)) {
        await q(sb.from("budgets").delete().eq("category_id", category_id).eq("month", month));
        return;
      }
      await q(sb.from("budgets").upsert({ category_id, month, amount_aud: +amount_aud }, { onConflict: "category_id,month" }));
    },

    // --- settings ---
    async getSettings() {
      const rows = await q(sb.from("settings").select("*"));
      const o = {};
      rows.forEach((r) => { o[r.key] = r.value; });
      return o;
    },
    async setSetting(key, value) {
      await q(sb.from("settings").upsert({ key, value }, { onConflict: "key" }));
    },
  };
}

function normalizeSupabaseUrl(url) {
  // Accept the base URL or the pasted REST endpoint (…/rest/v1/).
  return String(url || "").trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
}

async function initSupabase(url, key) {
  await loadSupabaseLib();
  const client = window.supabase.createClient(normalizeSupabaseUrl(url), String(key || "").trim(), { auth: { persistSession: false } });
  const store = makeSupabaseStore(client);
  await store.isSeeded(); // fail fast if URL/key are wrong or unreachable
  return store;
}
