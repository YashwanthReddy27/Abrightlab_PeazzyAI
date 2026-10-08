(() => {
  const { D, L, $, esc, usd, compact, pct, sum, plural, DRIVERS, DI, FLAGS, playText, playGroup, EFFORT, draft, store, shell } = PZ;
  const state = {
    approved: new Set(store.get("approved", [])), sent: new Set(store.get("sent", [])),
    group: "", playLimit: 5, flag: "", queueLimit: 5, open: null, opt: "routes", optLimit: 5,
    cost: store.get("cost", 150000), tGm: store.get("tGm", 25), tPay: store.get("tPay", 6),
  };
  const flagKey = (f) => f.type + ":" + f.loc;
  const approvedPlays = () => D.plays.filter((p) => state.approved.has(p.id));
  const approvedValue = () => sum(approvedPlays(), (p) => p.value);

  function renderFlow() {
    const loss = L.filter((l) => l.status === "loss").length;
    const steps = [
      ["Collect", `${L.length.toLocaleString()} locations`, `${D.vendors.length} vendors, ${D.customers.length} customers`],
      ["Diagnose", `${loss} losing money`, "six reasons, in dollars"],
      ["Optimize", `${D.clusters.length} routes`, "vendors scored and ranked"],
      ["Recommend", `${D.plays.length} fixes`, `${compact(sum(D.plays, (p) => p.value))} a month`],
      ["Approve", `${state.approved.size} approved`, `${compact(approvedValue())} a month`],
    ];
    $("flow").innerHTML = steps.map(([name, big, small], i) =>
      `<div class="step ${i === 4 ? "live" : ""}"><em>${i + 1} · ${name}</em><b>${big}</b><span>${small}</span></div>`).join("");
  }

  function renderPlays() {
    const groups = ["Automation", "Routes", "Pricing", "Vendors"];
    $("groupChips").innerHTML = `<button class="chip ${state.group ? "" : "on"}" data-group="">All fixes</button>` +
      groups.map((g) => `<button class="chip ${state.group === g ? "on" : ""}" data-group="${g}">${g} (${D.plays.filter((p) => playGroup(p) === g).length})</button>`).join("");
    const rows = D.plays.filter((p) => !state.group || playGroup(p) === state.group);
    $("plays").innerHTML = rows.slice(0, state.playLimit).map((p) => {
      const [title, why] = playText(p), on = state.approved.has(p.id);
      const link = p.flag ? `<button class="btn" data-queue="${p.flag}">Open in queue</button>`
        : `<a class="btn" href="data-model/index.html?${p.cluster !== undefined ? "cluster=" + p.cluster : p.cust !== undefined ? "cust=" + p.cust : "vendor=" + p.vendor}">See the sites</a>`;
      return `<div class="play">
        <div><div class="tag">${playGroup(p)}</div><h3>${esc(title)}</h3><p>${esc(why)}</p>
          <div class="facts">${plural(p.sites, "site")} · ${usd(p.gap)} a month at stake · expect to recover ${pct(p.capture, 0)} · ${EFFORT[p.effort]}</div></div>
        <div class="side"><div class="value">${usd(p.value)} <small>a month</small></div>
          <div class="acts">${link}<button class="btn ${on ? "done" : "primary"}" data-approve="${p.id}">${on ? "✓ Approved" : "Approve"}</button></div></div>
      </div>`;
    }).join("") || `<p class="sub">No fixes of this kind.</p>`;
    $("morePlays").hidden = rows.length <= state.playLimit;
  }

  function renderQueue() {
    const done = (f) => state.sent.has(flagKey(f));
    const groups = Object.keys(FLAGS).map((k) => ({ k, items: D.flags.filter((f) => f.type === k).sort((a, b) => Math.abs(b.amt) - Math.abs(a.amt)) })).filter((g) => g.items.length)
      .sort((a, b) => sum(b.items, (f) => Math.abs(f.amt)) - sum(a.items, (f) => Math.abs(f.amt)));
    $("queueSummary").textContent = `${D.flags.length} items in ${groups.length} groups · ${D.flags.filter(done).length} approved`;
    $("queue").innerHTML = groups.map(({ k, items }) => {
      const F = FLAGS[k], open = state.flag === k, handled = items.filter(done).length, all = handled === items.length;
      const rows = !open ? "" : items.slice(0, state.queueLimit).map((f) => {
        const l = L[f.loc], key = flagKey(f), msg = draft(f.type, l), isOpen = state.open === key;
        return `<div class="q-item ${isOpen ? "open" : ""}" data-key="${key}">
          <div class="q-head"><b>${esc(l.name)}</b><div class="amt">${usd(Math.abs(f.amt))}</div><div class="st ${done(f) ? "ok" : "thin"}"><i>${done(f) ? "●" : "◆"}</i>${done(f) ? "Approved" : "Waiting"}</div></div>
          <div class="q-body"><div class="what">${F.shows(l)}</div>
            ${msg ? `<div class="draft"><b>Draft message to ${msg[0]}</b>${esc(msg[1])}</div>` : ""}
            <button class="btn ${done(f) ? "done" : "primary"}" data-send="${key}">${done(f) ? "✓ Approved" : "Approve and send"}</button>
            <a class="btn" href="data-model/index.html?loc=${l.id}">See the analysis</a></div>
        </div>`;
      }).join("") + (items.length > state.queueLimit ? `<p class="center"><button class="btn" data-more="1">Show ${Math.min(10, items.length - state.queueLimit)} more</button></p>` : "");
      return `<div class="card q-group">
        <div class="q-top"><div><h3>${F.name}</h3><div class="what">${F.act}.</div><div class="fine">${plural(items.length, "site")} · ${usd(sum(items, (f) => Math.abs(f.amt)))} a month · ${handled} approved</div></div>
          <div class="acts"><button class="btn" data-flag="${k}">${open ? "Hide" : "Review"}</button><button class="btn ${all ? "done" : "primary"}" data-all="${k}">${all ? "✓ All approved" : "Approve all"}</button></div></div>
        ${rows}</div>`;
    }).join("");
  }

  function renderOptimizer() {
    document.querySelectorAll("#optChips .chip").forEach((c) => c.classList.toggle("on", c.dataset.opt === state.opt));
    let rows, head, body;
    if (state.opt === "routes") {
      rows = D.clusters.filter((c) => c.saving > 0).sort((a, b) => b.saving - a.saving);
      $("optSub").textContent = `${D.clusters.length} routes found. On ${rows.length} of them, giving the whole route to one qualified vendor saves about ${compact(sum(rows, (c) => c.saving))} a month.`;
      head = `<th>Route</th><th class="n">Sites</th><th class="n">Vendors today</th><th>Recommended vendor</th><th class="n">Saving a month</th>`;
      body = (c) => `<td>${D.metros[c.metro].name} route ${c.id + 1}</td><td class="n">${c.n}</td><td class="n">${c.vendors}</td><td>${esc(D.vendors[c.lead].name)}</td><td class="n">${usd(c.saving)}</td>`;
    } else {
      const deal = { A: "Preferred: first offer on new routes, quality bonus", B: "Standard terms", C: "Performance plan, no new sites" };
      rows = D.vendors.filter((v) => v.card).sort((a, b) => a.card.score - b.card.score);
      const n = (g) => rows.filter((v) => v.card.tier === g).length;
      $("optSub").textContent = `Each vendor is scored out of 100 on quality, price, time on site and how tightly their sites are grouped. ${n("A")} earn grade A, ${n("B")} grade B and ${n("C")} grade C. Lowest scores first.`;
      head = `<th>Vendor</th><th class="n">Score</th><th>Grade</th><th>Deal they get</th>`;
      body = (v) => `<td>${esc(v.name)}</td><td class="n">${v.card.score}</td><td><span class="tier">${v.card.tier}</span></td><td>${deal[v.card.tier]}</td>`;
    }
    $("optTable").innerHTML = `<thead><tr>${head}</tr></thead><tbody>` + rows.slice(0, state.optLimit).map((r) => `<tr>${body(r)}</tr>`).join("") + "</tbody>";
    $("moreOpt").hidden = rows.length <= state.optLimit;
    $("moreOpt").textContent = `Show all ${rows.length}`;
  }

  function renderResults() {
    const rev = sum(L, (l) => l.price - l.credits), margin = sum(L, (l) => l.margin);
    const plays = approvedPlays(), value = sum(plays, (p) => p.value), atRisk = sum(plays, (p) => p.value * p.riskShare);
    const gmNow = margin / rev, gmPlan = (margin + value) / rev, payback = value ? state.cost / value : Infinity;
    const insp = sum(L, (l) => l.inspection) / L.length;
    const status = (ok, pending) => pending ? `<span class="st thin"><i>◆</i>Approve fixes to see</span>` : ok ? `<span class="st ok"><i>●</i>On target</span>` : `<span class="st loss"><i>▼</i>Short of target</span>`;
    const rows = [
      ["Gross margin", pct(gmNow), pct(gmPlan), pct(state.tGm / 100, 0), status(gmPlan >= state.tGm / 100)],
      ["Recovered on loss-making and thin sites", "–", usd(atRisk) + " a month", "–", ""],
      ["Recovered on healthy sites, from the same fixes", "–", usd(value - atRisk) + " a month", "–", ""],
      ["Payback on the cost of the solution", "–", value ? payback.toFixed(1) + " months" : "–", state.tPay + " months", status(payback <= state.tPay, !value)],
      ["First-year return on investment", "–", value && state.cost ? ((value * 12 - state.cost) / state.cost).toFixed(1) + "x" : "–", "above 0", status(value * 12 > state.cost, !value)],
      ["Average inspection score (must not fall)", Math.round(insp), "tracked monthly", "85 or more", status(insp >= 85)],
    ];
    $("metrics").innerHTML = `<thead><tr><th>Measure</th><th class="n">Today</th><th class="n">With approved plan</th><th class="n">Leadership target</th><th>Status</th></tr></thead><tbody>` +
      rows.map((r) => `<tr><td>${r[0]}</td><td class="n">${r[1]}</td><td class="n">${r[2]}</td><td class="n">${r[3]}</td><td>${r[4]}</td></tr>`).join("") + "</tbody>";

    const total = DRIVERS.map((d, i) => sum(L, (l) => Math.max(0, l.comp[i])));
    const fixed = DRIVERS.map((d, i) => Math.min(total[i], sum(plays.filter((p) => p.driver === d.key), (p) => p.value)));
    const max = Math.max(...total);
    $("reasons").innerHTML = DRIVERS.map((d, i) => ({ d, i })).sort((a, b) => total[b.i] - total[a.i]).map(({ d, i }) =>
      `<div class="bar-row"><span class="bar-name">${d.name}<small>${d.hint}</small></span>
       <span class="bar-track"><span class="meter" style="width:calc(${(total[i] / max).toFixed(3)} * (100% - 190px))"><i style="width:${(100 * fixed[i] / total[i]).toFixed(1)}%"></i></span>
       <span class="bar-val">${compact(fixed[i])} of ${compact(total[i])} addressed</span></span></div>`).join("");
  }

  const show = shell("app", [["recs", "Recommendations"], ["queue", "Automation queue"], ["optimizer", "Routes and vendors"], ["results", "Results"]], (view) => {
    if (view === "results") renderResults();
    if (view === "recs") { renderFlow(); renderPlays(); }
  });
  const save = () => { store.set("approved", [...state.approved]); store.set("sent", [...state.sent]); };

  $("view-recs").onclick = (e) => {
    const t = e.target;
    if (t.dataset.group !== undefined) { state.group = t.dataset.group; state.playLimit = 5; renderPlays(); }
    if (t.dataset.approve !== undefined) {
      const id = +t.dataset.approve;
      state.approved.has(id) ? state.approved.delete(id) : state.approved.add(id);
      save(); renderFlow(); renderPlays();
    }
    if (t.dataset.queue) { state.flag = t.dataset.queue; state.queueLimit = 5; renderQueue(); show("queue"); }
    if (t.dataset.view) show(t.dataset.view);
    if (t.id === "morePlays") { state.playLimit += 10; renderPlays(); }
  };
  $("view-queue").onclick = (e) => {
    const t = e.target;
    if (t.dataset.flag) { state.flag = state.flag === t.dataset.flag ? "" : t.dataset.flag; state.queueLimit = 5; state.open = null; return renderQueue(); }
    if (t.dataset.all) {
      const items = D.flags.filter((f) => f.type === t.dataset.all), all = items.every((f) => state.sent.has(flagKey(f)));
      items.forEach((f) => (all ? state.sent.delete(flagKey(f)) : state.sent.add(flagKey(f))));
      save(); return renderQueue();
    }
    if (t.dataset.send) { state.sent.has(t.dataset.send) ? state.sent.delete(t.dataset.send) : state.sent.add(t.dataset.send); save(); return renderQueue(); }
    if (t.dataset.more) { state.queueLimit += 10; return renderQueue(); }
    const head = t.closest(".q-head");
    if (head) { const key = head.parentNode.dataset.key; state.open = state.open === key ? null : key; renderQueue(); }
  };
  $("view-optimizer").onclick = (e) => {
    if (e.target.dataset.opt) { state.opt = e.target.dataset.opt; state.optLimit = 5; renderOptimizer(); }
    if (e.target.id === "moreOpt") { state.optLimit = 999; renderOptimizer(); }
  };
  $("view-results").oninput = (e) => {
    if (!["cost", "tGm", "tPay"].includes(e.target.id)) return;
    state[e.target.id] = Math.max(0, +e.target.value || 0);
    store.set(e.target.id, state[e.target.id]);
    renderResults();
  };

  $("cost").value = state.cost; $("tGm").value = state.tGm; $("tPay").value = state.tPay;
  renderQueue(); renderOptimizer();
  show(new URLSearchParams(location.search).get("view") || "recs");
})();
