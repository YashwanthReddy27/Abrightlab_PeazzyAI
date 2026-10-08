# Peazyyy AI: the 2,000-Location Challenge

My submission is a data model with an analytical approach, plus a prototype app built on it. They are two separate things:

- **The data model** does the analysis: what is happening, where, and why, in dollars.
- **The app** does the automation and AI: ranked recommendations, an automation queue with drafted messages, route and vendor optimization, and a results scorecard.

Open `app/index.html` to use it. It runs on 2,000 synthetic locations; every name is invented and the figures show the method, not Peazy's real portfolio.

## How I frame the problem

The company loses money at some locations because it pays the subcontractor more than the customer pays it. That is the symptom. Underneath, price and cost are set by two processes that never meet: a contract is priced once, often for a whole account, and a vendor is sourced later, site by site. Nothing compares the two afterwards. So this is first a visibility problem (which sites, how much, which variable) and then a decision problem (which fix fits which site).

## Assumptions

- Every location has a contract price and a vendor working at an agreed rate.
- A vendor may serve one or many locations in an area. Sites far from a vendor's other work cost more.
- Peazy holds schedules, check-ins, inspections and photos. Prices and vendor payments sit in finance and can be joined by location.
- Leadership sets the target margin. I used 25% as a placeholder.

## Additional data I would want

- **Locations per area and distances between them**, to see where a route is possible.
- **Which vendors serve each area**, to see fragmentation.
- **Contract terms** (pricing model, start date, yearly increase), to tell underpriced-by-design from underpriced-by-age.
- **Vendor rate cards and every extra charge**, to separate base rate from travel and extras.
- **Site size, type and scope**, to estimate what the work should cost.
- **Local wages**, because one national price means different margins in different cities.

## How I find the root causes

Start with the books: what each customer pays against what we pay the vendor, per location per month. Where the second is larger, ask why. The model estimates a fair cost for each site and splits the shortfall into six reasons that add up exactly: customer price too low, vendor charges too much, extra visits not billed, travel to isolated sites, work beyond the contract, and poor-quality refunds. Each loss-making site is also compared with profitable sites of the same type, so the customers we make money on become the benchmark.

In the synthetic portfolio, 521 of 2,000 sites (26%) lose about $224K a month, and pricing is the largest reason. On real data the mix will differ, and that mix is the first thing I would want to learn.

## The solution I propose

A different fix per cause, not one blanket policy.

| Factor from the brief | What I propose |
|---|---|
| Sourcing and grouping | Source by route, not site by site |
| Clustering, route optimization | Group sites within 6 miles into routes |
| Frequency and scope | Catch visits and time beyond the contract; bill or stop them |
| Pricing, contract structures | Price per location and add yearly increases |
| Consolidation, marketplace | One vendor per route, or bids capped at fair cost |
| Labor utilization | Compare time on site with peers; flag crews that leave early |
| Location-based pricing | Rate card indexed to city wages, size and frequency |
| Vendor incentives | Scorecard grades that set each vendor's deal |
| Predictive models | Trend forecast and a trained loss-risk model |
| AI and automation | Ranked fixes, exceptions caught automatically, messages drafted |
| Operating model | From account-priced and site-sourced to location-priced and route-sourced |
| Something different | Share savings with customers who allow flexible visit days, so their site fits a route |

## Where AI, data and automation fit

- **Data** carries the most weight: the model shows where the business is breaking, down to the site and the variable.
- **Automation** handles what nobody sees today. If a crew visits a site twice in one day, the system catches it, reads the vendor's reason, and bills the customer, withholds payment, or fixes the schedule.
- **AI** optimizes routes and vendor assignments, ranks fixes by value for effort, and drafts the customer or vendor message. In the prototype the ranking is a real optimizer and the messages are template-written. A person approves before anything is sent.
- **Our own model.** A loss-risk model is trained on our own history and retrained as data arrives, replacing the current version only if it is at least as accurate. Today it is trained on synthetic data, so the pipeline is proven, not the accuracy.

## How I would measure it

- **ROI**: cost to build and run against margin recovered on the sites that were losing money.
- **The whole portfolio**: the same fixes should improve healthy sites too.
- **Leadership's own metrics**: target margin and payback are inputs, and they decide whether it is working.
- **The reasons by variable**: how much each of the six shrinks.
- **Guardrail**: inspection scores, so margin is not bought with quality.

## What I would build and test first

1. Load one region's real data and check the diagnoses against what operations already knows about 20 to 30 sites.
2. Pilot the two cheapest fixes on loss-making customers: billing unbilled visits, and moving sites onto a nearby vendor's route.
3. Measure recovered margin after 60 days, then decide whether to extend to repricing.

`data_model/` holds the model, SQL schema and training script; `app/` holds the site.
