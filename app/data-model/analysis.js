(() => {
  const { D, L, $, esc, usd, compact, pct, sum, plural, DRIVERS, DI, statusChip, REASON, FLAGS, fix, shell } = PZ;
  const ML = window.RISK || { risk: {}, metrics: null };
  const risk = (l) => ML.risk[l.id];
  const flagsOf = {};
  D.flags.forEach((f) => (flagsOf[f.loc] = flagsOf[f.loc] || new Set()).add(f.type));
  const state = { status: "loss", cause: "", metro: "", cust: "", vendor: "", cluster: "", flag: "", text: "", limit: 10, custLimit: 10 };
  const PEER = [["Customer pays per hour of work", "$", 1], ["We pay per hour of work", "$", -1], ["Miles from vendor to site", "", -1], ["Time on site vs. plan", "x", 0], ["Inspection score", "", 1], ["Sq ft cleaned per hour", "", 0]];

  const matches = (l) =>
    (state.status === "all" || l.status === "loss" || (state.status === "risk" && l.status === "thin")) &&
    (!state.cause || l.primary === state.cause) &&
    (state.metro === "" || l.metro === +state.metro) && (state.cust === "" || l.cust === +state.cust) &&
    (state.vendor === "" || l.vendor === +state.vendor) && (state.cluster === "" || l.cluster === +state.cluster) &&
    (!state.flag || (flagsOf[l.id] && flagsOf[l.id].has(state.flag))) &&
    (!state.text || l.name.toLowerCase().includes(state.text));

  function renderOverview() {
    const rev = sum(L, (l) => l.price - l.credits), margin = sum(L, (l) => l.margin);
    const loss = L.filter((l) => l.status === "loss"), thin = L.filter((l) => l.status === "thin");
    const rows = DRIVERS.map((d, i) => ({ ...d, amt: sum(loss, (l) => Math.max(0, l.comp[i])), n: loss.filter((l) => l.primary === d.key).length })).sort((a, b) => b.amt - a.amt);
    const tiles = [
      ["hero", "Lost each month on unprofitable locations", compact(-sum(loss, (l) => l.margin)), `${loss.length} of ${L.length.toLocaleString()} locations (${pct(loss.length / L.length, 0)}) cost more than they bring in`],
      ["", "Overall margin", pct(margin / rev), `target ${pct(D.targetGm, 0)}`],
      ["", "Close to the edge", thin.length, "locations making under 10%"],
      ["", "Biggest reason", rows[0].name, `${compact(rows[0].amt)} a month`],
    ];
    $("tiles").innerHTML = tiles.map(([cls, label, value, note]) =>
      `<div class="card tile ${cls}"><div class="label">${label}</div><div class="value" ${cls || typeof value === "number" || /^[\d$-]/.test(value) ? "" : 'style="font-size:18px;margin-top:8px"'}>${value}</div><div class="note">${note}</div></div>`).join("");
    const max = rows[0].amt;
    $("bars").innerHTML = rows.map((r) =>
      `<button class="bar-row" data-cause="${r.key}"><span class="bar-name">${r.name}<small>${r.hint}</small></span>
       <span class="bar-track"><span class="bar" style="width:calc(${(r.amt / max).toFixed(3)} * (100% - 130px))"></span><span class="bar-val">${compact(r.amt)} · ${plural(r.n, "site")}</span></span></button>`).join("");

    const cities = D.metros.map((m, i) => {
      const here = loss.filter((l) => l.metro === i);
      return { i, name: m.name, amt: -sum(here, (l) => l.margin), n: here.length, all: L.filter((l) => l.metro === i).length };
    }).filter((c) => c.n).sort((x, y) => y.amt - x.amt);
    $("cities").innerHTML = cities.slice(0, 8).map((c) =>
      `<button class="bar-row" data-metro="${c.i}"><span class="bar-name">${c.name}<small>${c.n} of ${c.all} sites losing money</small></span>
       <span class="bar-track"><span class="bar" style="width:calc(${(c.amt / cities[0].amt).toFixed(3)} * (100% - 70px))"></span><span class="bar-val">${compact(c.amt)}</span></span></button>`).join("");
  }

  function renderLocations() {
    const rows = L.filter(matches).sort((a, b) => a.margin - b.margin);
    const extra = [state.metro !== "" && D.metros[+state.metro].name, state.cust !== "" && D.customers[+state.cust].name, state.vendor !== "" && D.vendors[+state.vendor].name, state.cluster !== "" && `route ${+state.cluster + 1}`, state.flag && FLAGS[state.flag].name].filter(Boolean);
    $("locCount").textContent = `${plural(rows.length, "location")}${extra.length ? " · " + extra.join(" · ") : ""}`;
    $("locTable").innerHTML = `<thead><tr><th>Location</th><th>Status</th><th class="n">Left over each month</th><th>Main reason</th></tr></thead><tbody>` +
      rows.slice(0, state.limit).map((l) => `<tr class="click" data-id="${l.id}"><td>${esc(l.name)}</td><td>${statusChip(l.status)}</td>
        <td class="n">${usd(l.margin)}</td><td>${l.primary ? DRIVERS[DI[l.primary]].name : "–"}</td></tr>`).join("") + "</tbody>";
    $("more").hidden = rows.length <= state.limit;
  }

  function renderCustomers() {
    const agg = D.customers.map(() => ({ sites: 0, loss: 0, rev: 0, margin: 0, fair: 0 }));
    for (const l of L) { const a = agg[l.cust]; a.sites++; a.loss += l.status === "loss"; a.rev += l.price - l.credits; a.margin += l.margin; a.fair += l.targetPrice - l.price; }
    $("custTable").innerHTML = `<thead><tr><th>Customer</th><th>How they are priced</th><th class="n">Sites</th><th class="n">Losing money</th><th class="n">Margin</th></tr></thead><tbody>` +
      D.customers.map((c, i) => ({ c, a: agg[i] })).filter((r) => r.a.sites).sort((p, q) => p.a.margin / p.a.rev - q.a.margin / q.a.rev).slice(0, state.custLimit).map(({ c, a }) =>
        `<tr class="click" data-cust="${c.id}"><td>${esc(c.name)}</td><td>${c.pricing === "flat" ? "One national rate" : "Per location"}</td>
         <td class="n">${a.sites}</td><td class="n">${a.loss}</td><td class="n">${pct(a.margin / a.rev)}</td></tr>`).join("") + "</tbody>";
  }

  function renderForecast() {
    const m = ML.metrics;
    if (!m) { $("mlTiles").innerHTML = `<div class="card">Run data_model/train.py to train the model.</div>`; return; }
    const healthy = L.filter((l) => l.status !== "loss" && risk(l) !== undefined).sort((a, b) => risk(b) - risk(a));
    const high = healthy.filter((l) => risk(l) >= 0.5).length;
    $("mlTiles").innerHTML = [
      ["Learned from", m.rows.toLocaleString() + " sites", `synthetic for now; last trained ${m.trained}`],
      ["How often it ranks a loss-maker above a healthy site", pct(m.model.auc, 0), `a simple baseline manages ${pct(m.baseline.auc, 0)}; a coin flip 50%`],
      ["Healthy sites it flags as high risk", high, "more likely than not to start losing money"],
    ].map(([label, value, note]) => `<div class="card tile"><div class="label">${label}</div><div class="value">${value}</div><div class="note">${note}</div></div>`).join("");
    const top = m.importance.slice(0, 6), max = top[0][1];
    $("mlBars").innerHTML = top.map(([name, v]) => `<div class="bar-row"><span class="bar-name">${name}</span><span class="bar-track"><span class="bar" style="width:calc(${(v / max).toFixed(3)} * (100% - 20px))"></span></span></div>`).join("");
    $("riskTable").innerHTML = `<thead><tr><th>Location</th><th class="n">Makes today</th><th class="n">Chance of loss</th><th class="n">Trend forecast</th></tr></thead><tbody>` +
      healthy.slice(0, 6).map((l) => `<tr class="click" data-id="${l.id}"><td>${esc(l.name)}</td><td class="n">${usd(l.margin)}</td><td class="n">${pct(risk(l), 0)}</td><td class="n">${l.tip ? `negative in ${l.tip} mo` : "stays positive"}</td></tr>`).join("") + "</tbody>";
  }

  function renderExample() {
    const l = L.filter((x) => x.status === "loss").sort((a, b) => b.comp.filter((c) => c > 100).length - a.comp.filter((c) => c > 100).length || a.margin - b.margin)[0];
    const c = D.customers[l.cust];
    $("exampleIntro").textContent = `${l.name}: a ${l.sqft.toLocaleString()} sq ft ${D.types[c.type].toLowerCase()} cleaned ${l.freq} times a week.`;
    const line = (label, amt, note, cls = "") => `<div class="${cls}"><span>${label}${note ? `<small>${note}</small>` : ""}</span><span>${amt}</span></div>`;
    $("receipt").innerHTML =
      line("What this site should earn us", usd(l.targetPrice - l.should), `a fair price of ${usd(l.targetPrice)} less a fair cost of ${usd(l.should)}`) +
      DRIVERS.map((d, i) => (Math.abs(l.comp[i]) < 1 ? "" : line(d.name, (l.comp[i] > 0 ? "− " : "+ ") + usd(Math.abs(l.comp[i])), d.hint, "minus"))).join("") +
      line("What it actually earns us", usd(l.margin), `the customer pays ${usd(l.price - l.credits)}, we pay the vendor ${usd(l.cost)}`, "line");
  }

  function brief(l) {
    const ranked = DRIVERS.map((d, i) => [d.name.toLowerCase(), l.comp[i]]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
    const gap = sum(ranked, (x) => x[1]);
    const verdict = l.status === "loss" ? `loses ${usd(-l.margin)} a month` : `makes ${usd(l.margin)} a month (${pct(l.gm)})`;
    const top = ranked.slice(0, 2).map(([n, v]) => `${n} (${pct(v / gap, 0)})`).join(" and ");
    return `This site ${verdict}. The customer pays ${usd(l.price - l.credits)} and we pay the vendor ${usd(l.cost)}. A job like this should cost about ${usd(l.should)}.${ranked.length ? ` The main reasons for the shortfall: ${top}.` : ""}`;
  }

  const FLAG_FOR = { price: ["tip_forecast"], rate: ["short_visit"], freq: ["dup_bill", "dup_vendor", "dup_schedule", "over_schedule"], travel: ["remote"], scope: ["over_scope"], quality: ["low_quality"] };
  function actLink(l) {
    const mine = flagsOf[l.id] || new Set(), want = (FLAG_FOR[l.primary] || []).find((k) => mine.has(k));
    const play = D.plays.find((p) =>
      (l.primary === "price" && p.cust === l.cust) || (l.primary === "travel" && p.cluster !== undefined && p.cluster === l.cluster) ||
      (l.primary === "rate" && p.type === "rebid" && p.vendor === l.vendor) || (l.primary === "quality" && p.type === "performance" && p.vendor === l.vendor));
    if (want) return `../index.html?item=${want}:${l.id}`;
    if (play) return `../index.html?play=${play.id}`;
    return mine.size ? `../index.html?item=${[...mine][0]}:${l.id}` : "../index.html?view=recs";
  }

  function openDrawer(id) {
    const l = L[id], c = D.customers[l.cust], v = D.vendors[l.vendor], m = D.metros[l.metro], b = l.bench;
    const max = Math.max(...l.comp.map(Math.abs), 1);
    const bars = DRIVERS.map((d, i) => {
      const x = l.comp[i];
      return `<div class="wf-row"><span>${d.name}</span><div class="wf-plot">${x ? `<span class="wf-bar ${x > 0 ? "hurt" : "help"}" style="width:${(Math.abs(x) / max * 50).toFixed(1)}%"></span>` : ""}</div><span class="n">${x > 0 ? "-" : x < 0 ? "+" : ""}${usd(Math.abs(x))}</span></div>`;
    }).join("");
    const fmt = (x, i) => (PEER[i][1] === "$" ? "$" + x.toFixed(2) : i === 3 ? pct(x, 0) : Math.round(x).toLocaleString());
    const worse = (i) => { const dir = PEER[i][2], gap = b.own[i] / b.peer[i] - 1; return dir === 0 ? Math.abs(gap) > 0.15 : dir * gap < -0.1; };
    const kv = (k, val, flag) => `<dt>${k}</dt><dd class="${flag ? "flag" : ""}">${val}</dd>`;
    const f = fix(l);
    $("drawer").innerHTML = `
      <button class="btn" id="close" aria-label="Close">✕</button>
      <h2>${esc(l.name)}</h2>
      <div class="fine">${D.types[c.type]} · ${l.sqft.toLocaleString()} sq ft · ${m.name} · ${statusChip(l.status)}</div>
      <h4>What is happening</h4>
      <p style="margin:0;color:var(--ink-2)">${brief(l)}</p>
      ${f ? `<h4>What would fix it</h4><div class="note-box"><b>${f[0]}</b>${esc(f[1])}<div style="margin-top:10px"><a class="btn primary" href="${actLink(l)}">Act on this in the app →</a></div></div>` : ""}
      <h4>Where the money goes</h4>
      <div class="fine" style="margin-bottom:6px">Should earn ${usd(l.targetPrice - l.should)}, earns ${usd(l.margin)}. Red takes money away, blue adds it.</div>
      ${bars}
      <h4>Against sites that make money</h4>
      <div class="peer"><span class="h">${b.n} profitable ${D.types[c.type].toLowerCase()} sites${b.scope === "metro" ? " in the same city" : ""}</span><span class="h">This site</span><span class="h">Typical</span>
        ${PEER.map((p, i) => `<span>${p[0]}</span><span class="${worse(i) ? "flag" : ""}">${fmt(b.own[i], i)}</span><span>${fmt(b.peer[i], i)}</span>`).join("")}</div>
      <details><summary>All the facts behind this</summary><dl class="kv" style="margin-top:10px">
        ${kv("Contract price / fair price", `${usd(l.price)} / ${usd(l.targetPrice)}`, l.comp[0] > 0.1 * l.price)}
        ${kv("How the customer is priced", c.pricing === "flat" ? "One national rate" : "Per location")}
        ${kv("Contract", `${c.start}, ${c.escalator ? "rises 2% a year" : "no yearly increase"}`)}
        ${kv("Vendor", esc(v.name))}
        ${kv("Vendor rate / local going rate", `$${l.rate.toFixed(2)} / $${m.market.toFixed(2)} an hour`, l.rate > 1.1 * m.market)}
        ${kv("Miles from vendor", l.dist, l.trip > 0)}
        ${kv("Same vendor's sites within 10 miles", l.density, l.density === 0)}
        ${kv("Visits a week, contract / scheduled", `${l.freq} / ${l.actualFreq}`, l.actualFreq > l.freq)}
        ${kv("Same-day repeat visits", l.dups ? `${l.dups} (${REASON[l.dupReason]})` : "0", l.dups > 0)}
        ${kv("Time on site vs. plan", pct(l.dwell, 0), l.dwell > 1.2 || l.dwell < 0.8)}
        ${kv("Inspection score / open issues", `${l.inspection} / ${l.issues}`, l.inspection < 78)}
        ${kv("Refunds to customer", usd(l.credits), l.credits > 0)}
        ${kv("Trend forecast", l.status === "loss" ? "Already negative" : l.tip ? `Negative in ${l.tip} months` : "Stays positive for 3 years", !!l.tip && l.tip <= 12)}
        ${risk(l) === undefined ? "" : kv("Model's chance of loss", pct(risk(l), 0), risk(l) >= 0.5)}
      </dl></details>`;
    $("drawer").classList.add("open");
  }

  const show = shell("model", [["overview", "Overview"], ["locations", "Locations"], ["customers", "Customers"], ["forecast", "Forecast"], ["how", "How it works"]]);
  const fill = (id, first, items) => ($(id).innerHTML = `<option value="">${first}</option>` + items.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join(""));
  function setFilter(patch) {
    Object.assign(state, patch, { limit: 10 });
    $("fStatus").value = state.status; $("fCause").value = state.cause;
    renderLocations();
  }
  const clear = { status: "loss", cause: "", metro: "", cust: "", vendor: "", cluster: "", flag: "", text: "" };

  fill("fCause", "Any reason", DRIVERS.map((d) => [d.key, d.name]));
  renderOverview(); renderLocations(); renderCustomers(); renderForecast(); renderExample();

  $("fStatus").onchange = (e) => setFilter({ status: e.target.value });
  $("fCause").onchange = (e) => setFilter({ cause: e.target.value });
  $("fText").oninput = (e) => setFilter({ text: e.target.value.trim().toLowerCase() });
  $("fReset").onclick = () => { $("fText").value = ""; setFilter(clear); };
  $("more").onclick = () => { state.limit += 20; renderLocations(); };
  $("moreCust").onclick = () => { state.custLimit = 999; $("moreCust").hidden = true; renderCustomers(); };
  $("bars").onclick = (e) => { const b = e.target.closest("[data-cause]"); if (b) { setFilter({ ...clear, cause: b.dataset.cause }); show("locations"); } };
  $("custTable").onclick = (e) => { const r = e.target.closest("[data-cust]"); if (r) { setFilter({ ...clear, status: "all", cust: r.dataset.cust }); show("locations"); } };
  $("cities").onclick = (e) => { const b = e.target.closest("[data-metro]"); if (b) { setFilter({ ...clear, metro: b.dataset.metro }); show("locations"); } };
  document.querySelector("main").addEventListener("click", (e) => { const r = e.target.closest("tr[data-id]"); if (r) openDrawer(+r.dataset.id); });
  $("drawer").onclick = (e) => e.target.id === "close" && $("drawer").classList.remove("open");
  document.addEventListener("keydown", (e) => e.key === "Escape" && $("drawer").classList.remove("open"));

  const q = new URLSearchParams(location.search);
  const linked = ["cust", "vendor", "cluster", "flag"].find((k) => q.has(k));
  if (linked) { setFilter({ ...clear, status: "all", [linked]: q.get(linked) }); show("locations"); }
  else if (q.has("loc")) { show("locations"); openDrawer(+q.get("loc")); }
  else show(q.get("view") || "overview");
})();
