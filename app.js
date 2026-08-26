/* Budget App — single-file controller. Backends live in store.js, parsing in parser.js. */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const app = $("#app");

  // ---- state ----
  let categories = [];
  let settings = {};
  let pendingEntries = []; // rows waiting on the Confirm tab
  const state = { month: currentMonth() };

  function currentMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function catName(id) { const c = categories.find((x) => x.id === id); return c ? c.name : "Other"; }
  function catId(name) { const c = categories.find((x) => x.name === name); return c ? c.id : null; }
  function fx(cur) {
    if (cur === "AUD") return 1;
    if (cur === "THB") return +settings.fx_thb_aud || 0;
    if (cur === "USD") return +settings.fx_usd_aud || 0;
    return 1; // unknown currency -> treat 1:1, editable on confirm
  }
  function toAUD(amount, cur) { return Math.round((amount || 0) * fx(cur) * 100) / 100; }
  const fmt = (n) => "$" + (Math.round((n || 0) * 100) / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt0 = (n) => "$" + Math.round(n || 0).toLocaleString("en-AU"); // whole dollars, for the dashboard
  const pctOf = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);
  function monthLabel(m) { const [y, mo] = m.split("-"); return new Date(+y, +mo - 1, 1).toLocaleDateString("en-AU", { month: "short", year: "numeric" }); }

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 1800);
  }

  // ---- modal ----
  function openModal(title, bodyEl) {
    const back = el(`<div class="modal-back"><div class="modal"><h2>${esc(title)}</h2></div></div>`);
    $(".modal", back).appendChild(bodyEl);
    back.addEventListener("click", (e) => { if (e.target === back) closeModal(); });
    $("#modal-root").appendChild(back);
    return back;
  }
  function closeModal() { $("#modal-root").innerHTML = ""; }

  // ================= ROUTER =================
  const routes = {};
  function route() {
    const r = (location.hash.replace("#", "") || "dashboard").split("?")[0];
    const fn = routes[r] || routes.dashboard;
    document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === r));
    app.innerHTML = "";
    fn();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  // ================= DASHBOARD (home) =================
  routes.dashboard = async function () {
    app.appendChild(el(`<h1 class="screen-title" style="margin-bottom:12px">Budget</h1>`));

    // 1) Quick-entry box — parses, then hands off to the Confirm tab
    const quick = el(`<div class="card"><h3>➕ Add expense</h3>
      <div class="parse-box">
        <textarea id="sentence" placeholder="e.g. 5 aud coffee today"></textarea>
        <button class="btn parse-btn" id="parseBtn">Next</button>
      </div>
      <div class="small muted" style="margin-top:6px">Type or paste — <b>one expense per line</b> to add several at once. Review &amp; confirm on the next screen. · <a href="#entry" id="manualLink">Enter manually →</a></div>
    </div>`);
    app.appendChild(quick);
    function goParse() {
      const lines = $("#sentence").value.split(/\n+/).map((s) => s.trim()).filter(Boolean);
      if (!lines.length) { $("#sentence").focus(); return; }
      pendingEntries = lines.map((line) => parsedToEntry(parseSentence(line, categories, todayISO())));
      location.hash = "#entry";
    }
    $("#parseBtn").addEventListener("click", goParse);
    $("#manualLink").addEventListener("click", () => { pendingEntries = []; });

    // 2) This month's dashboard
    const txns = await DB.getTransactions();
    const budgets = await DB.getBudgets(state.month);
    const monthTxns = txns.filter((t) => t.date.slice(0, 7) === state.month);

    const spentByCat = {};
    monthTxns.forEach((t) => { spentByCat[t.category_id] = (spentByCat[t.category_id] || 0) + (t.amount_aud || 0); });
    const budgetByCat = {};
    budgets.forEach((b) => { budgetByCat[b.category_id] = b.amount_aud; });

    const totalSpent = Object.values(spentByCat).reduce((a, b) => a + b, 0);
    const totalBudget = Object.values(budgetByCat).reduce((a, b) => a + b, 0);
    const remaining = totalBudget - totalSpent;
    const spentPct = pctOf(totalSpent, totalBudget);
    const leftPct = spentPct == null ? null : 100 - spentPct;

    app.appendChild(el(`<div style="display:flex;justify-content:space-between;align-items:center;margin:4px 0 10px">
      <h2 class="screen-title" style="margin:0;font-size:18px">This month</h2>
      <select id="monthSel" style="width:auto">${monthOptions(state.month)}</select></div>`));

    // color by health of spend: green (comfortable) → blue (close) → red (over)
    const spentColor = spentPct == null ? "" : spentPct > 100 ? "c-red" : spentPct > 75 ? "c-blue" : "c-green";
    const leftColor = leftPct == null ? "" : leftPct < 0 ? "c-red" : leftPct < 25 ? "c-blue" : "c-green";
    app.appendChild(el(`<div class="dash-summary">
      <div class="stat"><div class="n ${spentColor}">${fmt0(totalSpent)}</div><div class="l">Spent${spentPct != null ? " · " + spentPct + "%" : ""}</div></div>
      <div class="stat"><div class="n">${fmt0(totalBudget)}</div><div class="l">Budget</div></div>
      <div class="stat"><div class="n ${leftColor}">${fmt0(remaining)}</div><div class="l">${remaining < 0 ? "Over · " + Math.abs(leftPct) + "%" : "Left" + (leftPct != null ? " · " + leftPct + "%" : "")}</div></div>
    </div>`));

    // rows: all categories that have a budget or spend this month
    const ids = new Set([...Object.keys(budgetByCat), ...Object.keys(spentByCat)]);
    const rows = [...ids].map((id) => ({ id, name: catName(id), spent: spentByCat[id] || 0, budget: budgetByCat[id] || 0 }))
      .sort((a, b) => (b.budget || b.spent) - (a.budget || a.spent));

    const card = el(`<div class="card"><h3>By category · ${esc(monthLabel(state.month))}</h3></div>`);
    if (!rows.length) card.appendChild(el(`<div class="empty">No spending or budgets for this month yet.</div>`));
    rows.forEach((r) => {
      const p = r.budget ? Math.min(100, (r.spent / r.budget) * 100) : (r.spent ? 100 : 0);
      const cls = !r.budget ? "" : r.spent > r.budget ? "over" : r.spent / r.budget >= 0.85 ? "warn" : "";
      const cp = pctOf(r.spent, r.budget);
      const right = r.budget
        ? `<b>${cp}%</b> · ${fmt0(r.spent)} / ${fmt0(r.budget)}`
        : `<b>${fmt0(r.spent)}</b> · no budget`;
      card.appendChild(el(`<div class="bar-item">
        <div class="bar-head"><span class="cat">${esc(r.name)}</span><span class="amt">${right}</span></div>
        <div class="track"><div class="fill ${cls}" style="width:${p}%"></div></div></div>`));
    });
    app.appendChild(card);

    $("#monthSel").addEventListener("change", (e) => { state.month = e.target.value; route(); });
  };

  function monthOptions(sel) {
    const opts = []; const d = new Date();
    for (let i = -18; i <= 6; i++) {
      const m = new Date(d.getFullYear(), d.getMonth() + i, 1);
      const v = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
      opts.push(`<option value="${v}" ${v === sel ? "selected" : ""}>${monthLabel(v)}</option>`);
    }
    return opts.reverse().join("");
  }

  // ================= ADD / CONFIRM tab =================
  function parsedToEntry(r) {
    return {
      date: r.date || todayISO(),
      category_id: catId(r.categoryName) || catId("Other"),
      amount: r.amount != null ? r.amount : "",
      currency: ["AUD", "THB", "USD"].includes(r.currency) ? r.currency : "AUD",
      notes: r.notes || "",
      payment: settings.last_payment || "Card",
      matched: r.matchedCategory,
    };
  }
  function blankEntry() {
    return { date: todayISO(), category_id: catId("Other"), amount: "", currency: "AUD", notes: "", payment: settings.last_payment || "Card", matched: true };
  }
  const catOptions = (sel) => categories.map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  const selOptions = (arr, sel) => arr.map((x) => `<option ${x === sel ? "selected" : ""}>${x}</option>`).join("");

  routes.entry = function () {
    if (!pendingEntries.length) pendingEntries = [blankEntry()];
    const multi = pendingEntries.length > 1;
    app.appendChild(el(`<h1 class="screen-title">${multi ? `Confirm ${pendingEntries.length} expenses` : "Confirm expense"}</h1>`));

    const list = el(`<div id="entryList"></div>`);
    app.appendChild(list);
    const addBtn = el(`<button class="btn btn-ghost" style="margin-bottom:12px">＋ Add another</button>`);
    app.appendChild(addBtn);
    const confirm = el(`<button class="btn" id="confirmAll" style="margin-bottom:20px"></button>`);
    app.appendChild(confirm);

    const totalAUD = () => pendingEntries.reduce((a, e) => a + toAUD(parseFloat(e.amount) || 0, e.currency), 0);
    function updateConfirm() {
      const n = pendingEntries.length;
      confirm.textContent = `Confirm ${n > 1 ? n + " expenses" : "expense"} · ${fmt(totalAUD())}`;
    }

    function renderRows() {
      list.innerHTML = "";
      pendingEntries.forEach((e, i) => {
        const row = el(`<div class="card entry-row">
          <div class="entry-head"><h3 style="margin:0">Expense ${i + 1}</h3><button class="rm" title="Remove">✕</button></div>
          <div class="row">
            <div class="col field"><label>Amount</label><input class="f_amount" type="number" inputmode="decimal" step="0.01" placeholder="0.00" value="${e.amount}"></div>
            <div class="col field" style="max-width:120px"><label>Currency</label><select class="f_cur">${selOptions(["AUD", "THB", "USD"], e.currency)}</select></div>
          </div>
          <div class="aud small muted" style="margin:-4px 2px 10px"></div>
          <div class="field"><label>Category</label><select class="f_cat">${catOptions(e.category_id)}</select>
            <div class="flag catflag" style="margin-top:6px;${e.matched ? "display:none" : ""}">Couldn't detect a category — please pick one</div></div>
          <div class="row">
            <div class="col field"><label>Date</label><input class="f_date" type="date" value="${e.date}"></div>
            <div class="col field"><label>Payment</label><select class="f_pay">${selOptions(["Card", "Transfer", "Cash"], e.payment)}</select></div>
          </div>
          <div class="field" style="margin-bottom:0"><label>Notes</label><input class="f_notes" type="text" placeholder="e.g. coffee" value="${esc(e.notes)}"></div>
        </div>`);

        const audEl = $(".aud", row);
        const refreshAUD = () => {
          const amt = parseFloat(e.amount) || 0;
          audEl.textContent = (e.currency !== "AUD" && amt) ? "≈ " + fmt(toAUD(amt, e.currency)) + " AUD" : "";
        };
        refreshAUD();

        $(".f_amount", row).addEventListener("input", (ev) => { e.amount = ev.target.value; refreshAUD(); updateConfirm(); });
        $(".f_cur", row).addEventListener("change", (ev) => { e.currency = ev.target.value; refreshAUD(); updateConfirm(); });
        $(".f_cat", row).addEventListener("change", (ev) => { e.category_id = ev.target.value; e.matched = true; $(".catflag", row).style.display = "none"; });
        $(".f_date", row).addEventListener("change", (ev) => { e.date = ev.target.value; });
        $(".f_pay", row).addEventListener("change", (ev) => { e.payment = ev.target.value; });
        $(".f_notes", row).addEventListener("input", (ev) => { e.notes = ev.target.value; });
        $(".rm", row).addEventListener("click", () => {
          pendingEntries.splice(i, 1);
          if (!pendingEntries.length) pendingEntries = [blankEntry()];
          location.hash = "#entry"; route(); // re-render (updates the "N expenses" title too)
        });

        list.appendChild(row);
      });
      updateConfirm();
    }

    addBtn.addEventListener("click", () => { pendingEntries.push(blankEntry()); route(); });

    confirm.addEventListener("click", async () => {
      const valid = pendingEntries.filter((e) => (parseFloat(e.amount) || 0) > 0);
      if (!valid.length) { toast("Enter an amount"); return; }
      for (const e of valid) {
        const amount = parseFloat(e.amount);
        await DB.addTransaction({
          date: e.date || todayISO(), category_id: e.category_id, amount,
          currency: e.currency, amount_aud: toAUD(amount, e.currency),
          notes: (e.notes || "").trim(), payment: e.payment,
        });
      }
      const last = valid[valid.length - 1].payment;
      settings.last_payment = last; await DB.setSetting("last_payment", last);
      const n = valid.length;
      pendingEntries = [];
      toast(n > 1 ? `Saved ${n} ✓` : "Saved ✓");
      location.hash = "#dashboard";
    });

    renderRows();
  };

  // ================= TRANSACTIONS =================
  routes.transactions = async function () {
    app.appendChild(el(`<h1 class="screen-title">History</h1>`));
    const bar = el(`<div class="filters">
      <select id="fMonth" style="flex:1"><option value="">All months</option>${monthOptions("").replace(/selected/g, "")}</select>
      <select id="fCat" style="flex:1"><option value="">All categories</option>${categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
    </div>`);
    const search = el(`<div class="field"><input type="search" id="fSearch" placeholder="Search notes…"></div>`);
    app.appendChild(bar); app.appendChild(search);
    const listCard = el(`<div class="card"></div>`);
    app.appendChild(listCard);

    async function render() {
      const all = await DB.getTransactions();
      const m = $("#fMonth").value, c = $("#fCat").value, q = $("#fSearch").value.trim().toLowerCase();
      let rows = all.filter((t) =>
        (!m || t.date.slice(0, 7) === m) &&
        (!c || t.category_id === c) &&
        (!q || (t.notes || "").toLowerCase().includes(q)));
      listCard.innerHTML = "";
      if (!rows.length) { listCard.appendChild(el(`<div class="empty">No transactions match.</div>`)); return; }
      const total = rows.reduce((a, t) => a + (t.amount_aud || 0), 0);
      listCard.appendChild(el(`<h3>${rows.length} txns · ${fmt(total)}</h3>`));
      rows.forEach((t) => {
        const orig = t.currency !== "AUD" ? `<span class="sub">${t.amount} ${esc(t.currency)}</span>` : "";
        const r = el(`<div class="list-row">
          <span class="cat-dot"></span>
          <div class="meta"><div class="t1">${esc(t.notes || catName(t.category_id))}</div>
            <div class="t2">${esc(catName(t.category_id))} · ${esc(t.date)}${t.payment ? " · " + esc(t.payment) : ""}</div></div>
          <div class="amt">${fmt(t.amount_aud)}${orig ? "<br>" + orig : ""}</div></div>`);
        r.addEventListener("click", () => editTxn(t, render));
        listCard.appendChild(r);
      });
    }
    $("#fMonth").addEventListener("change", render);
    $("#fCat").addEventListener("change", render);
    $("#fSearch").addEventListener("input", render);
    render();
  };

  function editTxn(t, after) {
    const body = el(`<div>
      <div class="field"><label>Date</label><input type="date" id="e_date" value="${esc(t.date)}"></div>
      <div class="field"><label>Category</label><select id="e_cat">${categories.map((c) => `<option value="${c.id}" ${c.id === t.category_id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div class="row">
        <div class="col field"><label>Amount</label><input type="number" step="0.01" id="e_amount" value="${t.amount}"></div>
        <div class="col field"><label>Currency</label><select id="e_cur">${["AUD","THB","USD"].map((x)=>`<option ${x===t.currency?"selected":""}>${x}</option>`).join("")}${["AUD","THB","USD"].includes(t.currency)?"":`<option selected>${esc(t.currency)}</option>`}</select></div>
      </div>
      <div class="field"><label>Notes</label><input type="text" id="e_notes" value="${esc(t.notes||"")}"></div>
      <div class="field"><label>Payment</label><select id="e_pay">${["Card","Transfer","Cash"].map((x)=>`<option ${x===t.payment?"selected":""}>${x}</option>`).join("")}${["Card","Transfer","Cash"].includes(t.payment||"")?"":`<option selected>${esc(t.payment||"")}</option>`}</select></div>
      <div class="btn-row"><button class="btn" id="e_save">Save</button><button class="btn btn-danger" id="e_del">Delete</button></div>
    </div>`);
    openModal("Edit transaction", body);
    $("#e_save", body).addEventListener("click", async () => {
      const amount = parseFloat($("#e_amount", body).value) || 0;
      const cur = $("#e_cur", body).value;
      await DB.updateTransaction(t.id, {
        date: $("#e_date", body).value, category_id: $("#e_cat", body).value,
        amount, currency: cur, amount_aud: toAUD(amount, cur),
        notes: $("#e_notes", body).value.trim(), payment: $("#e_pay", body).value,
      });
      closeModal(); toast("Updated ✓"); after();
    });
    $("#e_del", body).addEventListener("click", async () => {
      await DB.deleteTransaction(t.id); closeModal(); toast("Deleted"); after();
    });
  }

  // ================= BUDGETS =================
  routes.budgets = async function () {
    app.appendChild(el(`<div style="display:flex;justify-content:space-between;align-items:center">
      <h1 class="screen-title" style="margin:0">Budgets</h1>
      <select id="bMonth" style="width:auto">${monthOptions(state.month)}</select></div>`));
    app.appendChild(el(`<div class="small muted" style="margin:4px 2px 12px">Set a monthly AUD budget per category. No rollover — each month starts fresh.</div>`));
    const card = el(`<div class="card"></div>`);
    app.appendChild(card);

    async function render() {
      const budgets = await DB.getBudgets(state.month);
      const bmap = {}; budgets.forEach((b) => { bmap[b.category_id] = b.amount_aud; });
      card.innerHTML = `<h3>${esc(monthLabel(state.month))}</h3>`;
      categories.forEach((c) => {
        const row = el(`<div class="row" style="align-items:center;margin-bottom:10px">
          <div class="col" style="font-weight:600">${esc(c.name)}</div>
          <div style="width:130px"><input type="number" step="0.01" placeholder="—" data-cat="${c.id}" value="${bmap[c.id] != null ? bmap[c.id] : ""}"></div>
        </div>`);
        card.appendChild(row);
      });
      card.querySelectorAll("input[data-cat]").forEach((inp) => {
        inp.addEventListener("change", async () => {
          const v = inp.value === "" ? null : parseFloat(inp.value);
          await DB.setBudget(inp.dataset.cat, state.month, v);
          toast("Budget saved");
        });
      });
    }
    $("#bMonth").addEventListener("change", (e) => { state.month = e.target.value; render(); });
    render();
  };

  // ================= SETTINGS (incl. categories) =================
  routes.settings = async function () {
    app.appendChild(el(`<h1 class="screen-title">Settings</h1>`));

    // FX
    const fxCard = el(`<div class="card"><h3>Exchange rates → AUD</h3>
      <div class="row">
        <div class="col field"><label>THB → AUD</label><input type="number" step="0.00000001" id="s_thb" value="${settings.fx_thb_aud ?? ""}"></div>
        <div class="col field"><label>USD → AUD</label><input type="number" step="0.00001" id="s_usd" value="${settings.fx_usd_aud ?? ""}"></div>
      </div>
      <button class="btn btn-ghost btn-sm" id="s_fxsave">Save rates</button>
      <div class="small muted" style="margin-top:8px">Manual, like the sheet. Applied to future saves; existing AUD amounts don't change.</div>
    </div>`);
    app.appendChild(fxCard);
    $("#s_fxsave").addEventListener("click", async () => {
      settings.fx_thb_aud = parseFloat($("#s_thb").value) || 0;
      settings.fx_usd_aud = parseFloat($("#s_usd").value) || 0;
      await DB.setSetting("fx_thb_aud", settings.fx_thb_aud);
      await DB.setSetting("fx_usd_aud", settings.fx_usd_aud);
      toast("Rates saved ✓");
    });

    // Categories
    const catCard = el(`<div class="card"><h3>Categories</h3></div>`);
    categories.forEach((c) => {
      const row = el(`<div class="list-row">
        <div class="meta"><div class="t1">${esc(c.name)}</div>
        <div class="t2">${(c.keywords || []).length} keywords</div></div>
        <button class="btn btn-ghost btn-sm">Edit</button></div>`);
      $("button", row).addEventListener("click", () => editCategory(c));
      catCard.appendChild(row);
    });
    const addRow = el(`<button class="btn btn-ghost btn-sm" style="margin-top:10px">+ Add category</button>`);
    addRow.addEventListener("click", () => editCategory(null));
    catCard.appendChild(addRow);
    app.appendChild(catCard);

    // Passcode
    const pcCard = el(`<div class="card"><h3>Security</h3>
      <div class="field"><label>4-digit passcode ${settings.passcode ? "(set)" : "(none)"}</label>
      <input type="tel" maxlength="4" id="s_pc" placeholder="••••" value=""></div>
      <button class="btn btn-ghost btn-sm" id="s_pcsave">${settings.passcode ? "Change" : "Set"} passcode</button>
      ${settings.passcode ? `<button class="btn btn-danger btn-sm" id="s_pcclear" style="margin-left:8px">Remove</button>` : ""}
    </div>`);
    app.appendChild(pcCard);
    $("#s_pcsave").addEventListener("click", async () => {
      const v = $("#s_pc").value.trim();
      if (!/^\d{4}$/.test(v)) { toast("Enter 4 digits"); return; }
      settings.passcode = v; await DB.setSetting("passcode", v); $("#s_pc").value = ""; toast("Passcode set ✓"); route();
    });
    if ($("#s_pcclear")) $("#s_pcclear").addEventListener("click", async () => {
      settings.passcode = ""; await DB.setSetting("passcode", ""); toast("Passcode removed"); route();
    });

    // Sync (Supabase) — informational + config
    const syncCard = el(`<div class="card"><h3>Cross-device sync (optional)</h3>
      <div class="small muted" style="margin-bottom:10px">Right now data is stored on this device. To sync phone + laptop, create a free Supabase project, run <code>supabase/schema.sql</code>, and paste the keys here. See <code>README.md</code>.</div>
      <div class="field"><label>Supabase URL</label><input type="url" id="s_surl" placeholder="https://xxxx.supabase.co" value="${esc(settings.supabase_url||"")}"></div>
      <div class="field"><label>Supabase anon key</label><input type="text" id="s_skey" placeholder="eyJ…" value="${esc(settings.supabase_key||"")}"></div>
      <button class="btn btn-ghost btn-sm" id="s_synsave">Save sync config</button>
      <div class="small muted" style="margin-top:8px">Saved for when the Supabase adapter is enabled. Local mode keeps working meanwhile.</div>
    </div>`);
    app.appendChild(syncCard);
    $("#s_synsave").addEventListener("click", async () => {
      settings.supabase_url = $("#s_surl").value.trim(); settings.supabase_key = $("#s_skey").value.trim();
      await DB.setSetting("supabase_url", settings.supabase_url);
      await DB.setSetting("supabase_key", settings.supabase_key);
      toast("Sync config saved");
    });

    // Data export
    const dataCard = el(`<div class="card"><h3>Data</h3>
      <button class="btn btn-ghost btn-sm" id="s_export">Export JSON backup</button></div>`);
    app.appendChild(dataCard);
    $("#s_export").addEventListener("click", async () => {
      const dump = { categories: await DB.getCategories(), transactions: await DB.getTransactions(), budgets: await DB.getBudgets(), settings: await DB.getSettings() };
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "budget-backup.json"; a.click();
    });
  };

  function editCategory(c) {
    const isNew = !c;
    const body = el(`<div>
      <div class="field"><label>Name</label><input type="text" id="c_name" value="${esc(c ? c.name : "")}"></div>
      <div class="field"><label>Keywords (comma-separated)</label>
        <textarea id="c_kw" placeholder="woolworths, aldi, coles">${esc(c ? (c.keywords || []).join(", ") : "")}</textarea>
        <div class="small muted" style="margin-top:4px">Used to auto-detect this category from typed sentences.</div></div>
      <div class="btn-row"><button class="btn" id="c_save">Save</button>
      ${isNew ? "" : `<button class="btn btn-danger" id="c_del">Delete</button>`}</div>
    </div>`);
    openModal(isNew ? "Add category" : "Edit category", body);
    $("#c_save", body).addEventListener("click", async () => {
      const name = $("#c_name", body).value.trim();
      if (!name) { toast("Name required"); return; }
      const kws = $("#c_kw", body).value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (isNew) await DB.addCategory(name, kws); else await DB.updateCategory(c.id, { name, keywords: kws });
      categories = await DB.getCategories(); closeModal(); toast("Saved ✓"); route();
    });
    if (!isNew) $("#c_del", body).addEventListener("click", async () => {
      if (c.name === "Other") { toast("Can't delete Other"); return; }
      await DB.deleteCategory(c.id); categories = await DB.getCategories(); closeModal(); toast("Deleted — txns moved to Other"); route();
    });
  }

  // ================= PASSCODE LOCK =================
  function showLock() {
    const lock = $("#lock");
    let entered = "";
    function render(err) {
      lock.innerHTML = "";
      const wrap = el(`<div class="lock">
        <h1>Budget</h1><div class="muted small">Enter passcode</div>
        <div class="dots">${[0,1,2,3].map((i)=>`<div class="dot ${err?"err":(i<entered.length?"on":"")}"></div>`).join("")}</div>
        <div class="keys"></div></div>`);
      const keys = $(".keys", wrap);
      ["1","2","3","4","5","6","7","8","9","","0","⌫"].forEach((k) => {
        if (k === "") { keys.appendChild(el(`<button class="key blank"></button>`)); return; }
        const b = el(`<button class="key">${k}</button>`);
        b.addEventListener("click", () => {
          if (k === "⌫") { entered = entered.slice(0, -1); return render(false); }
          if (entered.length >= 4) return;
          entered += k;
          if (entered.length === 4) {
            if (entered === settings.passcode) { lock.style.display = "none"; lock.innerHTML = ""; }
            else { entered = ""; render(true); setTimeout(() => render(false), 500); }
          } else render(false);
        });
        keys.appendChild(b);
      });
      lock.appendChild(wrap);
    }
    lock.style.display = "block"; render(false);
  }

  // ================= INIT =================
  async function seedIfNeeded() {
    if (await DB.isSeeded()) return;
    try {
      const res = await fetch("seed.data.json");
      const seed = await res.json();
      await DB.seed(seed);
      console.log("Seeded from seed.data.json");
    } catch (e) {
      // Minimal fallback seed so the app still works if the file can't be fetched
      await DB.seed({ categories: [{ name: "Other", keywords: [] }, { name: "Groceries", keywords: ["woolworths","aldi","coles"] }, { name: "Dining", keywords: ["coffee","lunch"] }],
        budgets: [], settings: [{ key: "fx_thb_aud", value: 0.04256241 }, { key: "fx_usd_aud", value: 1.39301 }, { key: "last_payment", value: "Card" }], transactions: [] });
      console.warn("seed.data.json not reachable — used minimal fallback", e);
    }
  }

  async function init() {
    await seedIfNeeded();
    categories = await DB.getCategories();
    settings = await DB.getSettings();
    // Opening the Add tab from the nav always starts a fresh blank row
    const navAdd = document.getElementById("navAdd");
    if (navAdd) navAdd.addEventListener("click", () => { pendingEntries = []; });
    if (settings.passcode) showLock();
    if (!location.hash) location.hash = "#dashboard";
    route();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }
  init();
})();
