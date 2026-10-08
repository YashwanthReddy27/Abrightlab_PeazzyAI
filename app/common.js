window.PZ = (() => {
  const D = window.DATA, L = D.locations;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const usd = (n) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
  const compact = (n) => {
    const a = Math.abs(n), s = n < 0 ? "-$" : "$";
    return a >= 1e6 ? s + (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? s + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "K" : s + Math.round(a);
  };
  const pct = (x, d = 1) => (x * 100).toFixed(d) + "%";
  const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

  const DRIVERS = [
    { key: "price", name: "Customer price too low", hint: "contract below what the work costs" },
    { key: "rate", name: "Vendor charges too much", hint: "above the local going rate" },
    { key: "freq", name: "Extra visits not billed", hint: "over schedule or same-day repeats" },
    { key: "travel", name: "Travel to isolated sites", hint: "trip charges, no nearby work" },
    { key: "scope", name: "Work beyond the contract", hint: "extras paid but not passed on" },
    { key: "quality", name: "Poor quality refunds", hint: "credits after failed inspections" },
  ];
  const DI = Object.fromEntries(DRIVERS.map((d, i) => [d.key, i]));
  const STATUS = { loss: ["▼", "Losing money"], thin: ["◆", "Thin margin"], ok: ["●", "Healthy"] };
  const statusChip = (s) => `<span class="st ${s}"><i>${STATUS[s][0]}</i>${STATUS[s][1]}</span>`;
  const REASON = { customer_request: "customer asked for a re-clean", emergency: "emergency call-out", failed_inspection: "first clean failed inspection", schedule_error: "booked twice in the schedule" };

  const FLAGS = {
    dup_bill: { name: "Repeat visit, customer asked", shows: (l) => `${plural(l.dups, "same-day repeat visit")}: ${REASON[l.dupReason]}`, act: "Bill the customer with the vendor's reason, check-in times and photos" },
    dup_vendor: { name: "Repeat visit, first clean failed", shows: (l) => `${plural(l.dups, "same-day repeat visit")}: ${REASON[l.dupReason]}`, act: "Withhold vendor payment for the re-clean" },
    dup_schedule: { name: "Repeat visit, booked twice", shows: (l) => `${plural(l.dups, "same-day repeat visit")}: ${REASON[l.dupReason]}`, act: "Remove the duplicate booking and block it at check-in" },
    over_schedule: { name: "More visits than the contract", shows: (l) => `${l.actualFreq} visits a week scheduled, ${l.freq} in the contract`, act: "Ask the customer to pay for the extra visits or return to the contract" },
    over_scope: { name: "Crews working beyond scope", shows: (l) => `${l.dwell.toFixed(1)}x the planned time on site, ${usd(l.extras)} extras paid`, act: "Send a change order with the time and photo record" },
    short_visit: { name: "Crews leaving early", shows: (l) => `on site for ${pct(l.dwell, 0)} of the paid time`, act: "Pay the vendor on verified time" },
    low_quality: { name: "Failed inspections", shows: (l) => `inspection score ${l.inspection}, ${plural(l.issues, "open issue")}`, act: "Start a vendor performance plan" },
    tip_forecast: { name: "About to start losing money", shows: (l) => `forecast to go negative in ${plural(l.tip, "month")}`, act: "Start the renewal conversation now" },
    remote: { name: "Isolated site, no route", shows: (l) => `${l.dist} miles from the vendor, ${usd(l.trip)} a month in travel`, act: "Add a remote-site charge or plan an exit" },
  };

  const PLAYS = {
    route: ["Routes", (p) => { const c = D.clusters[p.cluster]; return [`Put ${D.metros[c.metro].name} route ${c.id + 1} under one vendor`, `${c.vendors} vendors serve ${c.n} sites within 6 miles of each other. ${D.vendors[c.lead].name} already has ${c.leadSites} of them and passes quality and price checks. Move ${c.moved} more sites to them as one ${c.route}-mile route.`]; }],
    remote: ["Routes", (p) => ["Add a travel charge to isolated sites, or exit them", `${p.sites} sites pay trip charges, have no qualified vendor nearby and too few neighbours to form a route.`]],
    index_price: ["Pricing", (p) => { const c = D.customers[p.cust]; return [`Price ${c.name} by location`, `One national rate covers every site. ${p.sites} sites in higher-cost cities are priced below what the work costs there.`]; }],
    reprice: ["Pricing", (p) => { const c = D.customers[p.cust]; return [`Reprice ${c.name} at renewal${c.escalator ? "" : " and add a yearly increase"}`, `Contract from ${c.start}${c.escalator ? "" : " with no yearly increase"}. ${p.sites} sites are priced below what the work costs today.`]; }],
    tip_forecast: ["Pricing", (p) => ["Renew early on sites about to start losing money", `${p.sites} sites still make money but are forecast to go negative within 12 months as wages rise faster than their price.`]],
    rebid: ["Vendors", (p) => { const v = D.vendors[p.vendor]; return [`Rebid ${v.name}'s sites`, `Charges ${pct(v.card.premium, 0)} above the local going rate across ${p.sites} sites. Invite nearby qualified vendors to bid, capped at what the work should cost.`]; }],
    performance: ["Vendors", (p) => { const v = D.vendors[p.vendor]; return [`Put ${v.name} on a performance plan`, `Scorecard ${v.card.score} out of 100, average inspection ${v.card.insp}. Customers were refunded on ${p.sites} of their sites. Tie part of their pay to inspection results.`]; }],
    dup_bill: ["Automation", () => ["Bill customers for repeat visits they asked for", "A crew went back the same day because the customer asked or there was an emergency. Nobody billed it. The system adds it to the invoice with the vendor's reason, times and photos."]],
    dup_vendor: ["Automation", () => ["Stop paying for re-cleans after a failed first clean", "The second visit happened because the first failed inspection. The system withholds that payment from the vendor."]],
    dup_schedule: ["Automation", () => ["Block visits that were booked twice", "The same visit was scheduled twice by mistake. The system removes the duplicate and blocks the second check-in."]],
    over_schedule: ["Automation", () => ["Bill or stop visits beyond the contract", "The schedule has more visits a week than the contract pays for. The system asks the customer to pay for them or returns to the contracted schedule."]],
    over_scope: ["Automation", () => ["Send change orders where crews work beyond scope", "Crews spend far longer on site than planned and the vendor bills extras we do not pass on. The system sends the customer a change order with the evidence."]],
    short_visit: ["Automation", () => ["Pay on verified time where crews leave early", "Check-in records show crews on site for less than 80% of the time we pay for."]],
  };
  const playText = (p) => PLAYS[p.type][1](p);
  const playGroup = (p) => PLAYS[p.type][0];
  const EFFORT = ["", "Low effort", "Medium effort", "High effort"];

  function draft(kind, l) {
    const c = D.customers[l.cust], v = D.vendors[l.vendor], m = D.metros[l.metro];
    const times = (n) => `${n} day${n > 1 ? "s" : ""}`;
    switch (kind) {
      case "dup_bill": return ["customer", `Our crew returned to this site a second time on ${times(l.dups)} last month (${REASON[l.dupReason]}). Check-in times and photos are attached. These visits are outside the contracted ${l.freq} a week, so ${usd(l.dupCost)} has been added to this month's invoice.`];
      case "dup_vendor": return ["vendor", `We see a same-day repeat visit at this site on ${times(l.dups)} last month because the first clean failed inspection. Re-cleans are not billable, so ${usd(l.dupCost)} will not be paid on this month's statement.`];
      case "dup_schedule": return ["operations team", `This site was booked twice on ${times(l.dups)} last month and both visits were paid (${usd(l.dupCost)}). The duplicate bookings have been removed and a second check-in on the same day now needs approval.`];
      case "over_schedule": case "freq": return ["customer", `This site is contracted for ${l.freq} visits a week and has been receiving ${l.actualFreq}. Would you like to keep the extra visits at ${usd(l.rate * l.hours * (l.actualFreq - l.freq) * D.weeksPerMonth)} a month, or return to the contracted schedule from next week?`];
      case "over_scope": case "scope": return ["customer", `Crews are spending ${l.dwell.toFixed(1)} times the planned time at this site. The check-in record and photos are attached. We can add the extra work to the contract for ${usd(l.extras)} a month, or agree what to take out.`];
      case "short_visit": return ["vendor", `Check-in records show your crew on site for ${pct(l.dwell, 0)} of the time this job is paid for. From next month, payment for this site follows verified time on site.`];
      case "low_quality": case "quality": return ["vendor", `This site scored ${l.inspection} at its last inspection with ${l.issues} open issues, and we refunded the customer ${usd(l.credits)}. From next month part of your payment here depends on the inspection score. We will review again in 60 days.`];
      case "tip_forecast": return ["account manager", `This site makes ${usd(l.margin)} a month today and is forecast to go negative in ${l.tip} months. The contract dates from ${c.start}${c.escalator ? "" : " and has no yearly increase"}. Suggested renewal price: ${usd(l.targetPrice)} a month.`];
      case "remote": case "travel": return ["customer", `This site is ${l.dist} miles from the nearest crew we can assign, which adds ${usd(l.trip)} a month in travel. At renewal we can add a remote-site charge, or reduce visits from ${l.freq} a week to keep the price where it is.`];
      case "price": return ["customer", `Your ${c.start} agreement prices this site at ${usd(l.price)} a month. Cleaning a ${l.sqft.toLocaleString()} sq ft site ${l.freq} times a week in ${m.name} now costs about ${usd(l.should)}. We would like to move it to ${usd(l.targetPrice)} at renewal and add a yearly adjustment so a step like this is not needed again.`];
      case "rate": return ["vendor", `We are reviewing this site. Your rate of $${l.rate.toFixed(2)} an hour is ${pct(l.rate / m.market - 1, 0)} above what comparable vendors in ${m.name} charge. We can keep it with you at $${m.market.toFixed(2)}; otherwise it goes out for bids together with nearby sites.`];
      default: return null;
    }
  }

  function fix(l) {
    const c = D.customers[l.cust], m = D.metros[l.metro];
    switch (l.primary) {
      case "price":
        if (c.pricing === "flat" && m.idx > 1.05) return ["Price this site by its location", `${c.name} pays one national rate, but wages in ${m.name} run ${pct(m.idx - 1, 0)} above average. A fair price here is ${usd(l.targetPrice)} a month.`];
        if (!c.escalator && c.start <= 2023) return ["Reprice and add a yearly increase", `Priced in ${c.start} with no yearly increase while wages kept rising. A fair price today is ${usd(l.targetPrice)} a month.`];
        return ["Reprice at renewal", `The contract is ${usd(l.comp[0])} a month under a fair price of ${usd(l.targetPrice)}.`];
      case "rate": return ["Rebid the site", `The vendor charges $${l.rate.toFixed(2)} an hour. Vendors in ${m.name} typically charge $${m.market.toFixed(2)}.`];
      case "freq":
        if (l.dups && l.dupCost >= l.comp[2] / 2) return ["Settle the same-day repeat visits", `${plural(l.dups, "repeat visit")} last month cost ${usd(l.dupCost)}. Reason given: ${REASON[l.dupReason]}.`];
        return ["Bill the extra visits or stop them", `${l.actualFreq} visits a week are scheduled; the contract pays for ${l.freq}.`];
      case "travel":
        if (l.alt) return ["Move to a vendor already working nearby", `${D.vendors[l.alt.v].name} already cleans ${l.alt.n} sites within 12 miles. Moving this site saves about ${usd(l.alt.saving)} a month.`];
        if (l.cluster !== null) return ["Fold into its local route", `This site belongs to ${m.name} route ${l.cluster + 1}. One vendor covering the route removes the travel charge.`];
        return ["Add a travel charge, or exit", `${l.dist} miles from the vendor and no other work nearby: ${usd(l.trip)} a month in trip charges.`];
      case "scope": return ["Send a change order", `Crews spend ${l.dwell.toFixed(1)}x the planned time on site and the vendor bills ${usd(l.extras)} a month in extras we do not pass on.`];
      case "quality": return ["Put the vendor on a performance plan", `Inspection score ${l.inspection}, ${plural(l.issues, "open issue")}, ${usd(l.credits)} a month refunded to the customer.`];
      default: return null;
    }
  }

  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem("pz-" + key)) ?? fallback; } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem("pz-" + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ } },
  };

  function shell(area, views, onView) {
    const up = area === "model" ? "../" : "";
    document.body.insertAdjacentHTML("afterbegin", `
      <div class="top">
        <div class="top-in">
          <a class="brand" href="${up}index.html">Peazyyy <span>AI</span></a>
          <nav class="areas" aria-label="Area">
            <a href="${up}data-model/index.html" class="${area === "model" ? "on" : ""}">Data model · analysis</a>
            <a href="${up}index.html" class="${area === "app" ? "on" : ""}">App · automation and AI</a>
          </nav>
          <span class="badge">Prototype on ${L.length.toLocaleString()} synthetic locations</span>
        </div>
        <nav class="views" id="views">${views.map(([k, t]) => `<button data-view="${k}">${t}</button>`).join("")}</nav>
      </div>`);
    const show = (view) => {
      document.querySelectorAll("#views button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
      views.forEach(([k]) => ($("view-" + k).hidden = k !== view));
      window.scrollTo(0, 0);
      if (onView) onView(view);
    };
    $("views").onclick = (e) => e.target.dataset.view && show(e.target.dataset.view);
    return show;
  }

  return { D, L, $, esc, usd, compact, pct, sum, plural, DRIVERS, DI, statusChip, REASON, FLAGS, playText, playGroup, EFFORT, draft, fix, store, shell };
})();
