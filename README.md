# CerealBox AI Studio (prototype)

Prepared by **Sohaib Ahmed** for the CerealBox Agency AI Automation & Creative Workflow Challenge.

Prototype for the **CerealBox Agency AI Automation & Creative Workflow Challenge**. It covers two things:

1. **A workflow design for all nine areas.** Copywriting, Static Creative, Script Writing, UGC Video, Video Editing, Media Buyer, Idea Generator, Landing Pages and Toast/Meta analysis, plus how they connect.
   - Plain-language illustrated walkthrough: [`docs/how-it-works.html`](docs/how-it-works.html), published at https://claude.ai/artifact/AAA98i1iS7cMiiqnGNJDYg
   - Detailed workflow map (per-area diagrams, tools, QC, roadmap): [`docs/workflow-map.html`](docs/workflow-map.html), published at https://claude.ai/artifact/4JNAY8LnAzHai6f7Cp4kLe
   - Mermaid source and notes: [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md)
2. **Two working MVP demos**, connected to each other:
   - **Demo A, Creative:** Client → Campaign → Brief → **AI Idea Generator** → human approval → **AI Copywriting** → QC → edit/regenerate → approval → export
   - **Demo B, Performance:** Meta CSV → validation → **Toast** multi-client dashboard → AI summary (figure-checked) → **Media Buyer** recommendations (read-only) → accept/reject → **accepted learnings feed the Idea Generator**

All clients and ad data are **fictional sample data**. Nothing connects to live CerealBox systems or ad accounts.

## Run it

Requires Node 22.13+ (tested on Node 26). **No database:** data is stored in a JSON file (`data/cerealbox.json`), created automatically.

```bash
npm install
cp .env.example .env.local      # add OLLAMA_API_KEY to use Ollama Cloud
npm run dev                     # http://localhost:3000
```

- **No key?** The app uses a **mock provider**. Its outputs are template-based and labelled "Mock provider" everywhere, so nothing pretends to be AI.
- **Real AI (default: Ollama Cloud):** create a key at https://ollama.com/settings/keys and set `OLLAMA_API_KEY` in `.env.local`. The default model is `gpt-oss:120b`; change it with `OLLAMA_MODEL` (list available models with `curl https://ollama.com/api/tags`). Gemini (`GEMINI_API_KEY`), OpenRouter (`OPENROUTER_API_KEY`) and a local Ollama daemon (`OLLAMA_MODEL` + `OLLAMA_BASE_URL=http://localhost:11434`, no key) are also supported. The sidebar shows which provider and model are active.
- **Reset:** stop the server and delete `data/cerealbox.json`. The app starts empty.

```bash
npm test          # 51 unit + integration tests (in-memory DB, mock AI)
npm run typecheck
npm run lint
npm run build && npm start
```

## Using the app

The **campaign workspace** runs the whole thing end to end. Its stepper shows all nine stages, what each needs, and the next step:

1. **Clients & campaigns:** create a campaign for a sample client and fill in the brief. *Proof points* are the only facts AI may use.
2. **Ideas** (on the campaign page): generate, approve or reject with a reason, and rate.
3. **Ad copy** (on the campaign page): unlocks after an idea is approved. Edit, regenerate a field, approve, export CSV.
4. **Static creative**, from approved copy: visual concepts, image prompts and template-rendered ad previews in 1:1, 4:5 and 9:16.
5. **Video script**, from an approved idea: hooks plus a scene-by-scene script checked against the target length.
6. **UGC video**, from an approved script: production pack and render job spec (no video provider connected, so it's marked "not submitted").
7. **Video edit**, from an approved script: timeline, captions, B-roll, music and export plan (rendering not connected).
8. **Landing page**, from approved copy: sections and copy with a desktop/mobile preview. Nothing is published.
9. **Performance:** *Toast* → load sample data → dashboard and AI summary. In *Media Buyer*, accept a recommendation and its learning feeds the next idea batch.

Everything waiting for a decision is in **Approvals**, and every AI call and decision is in **Activity & AI logs**. The seed creates 3 fictional sample clients with no campaigns.

## Architecture

```
src/
  app/                    Next.js 16 App Router pages + server actions (single backend)
    actions.ts            all mutations: Zod-validated, return real outcome (no fake success)
  lib/
    ai/providers.ts       Ollama (cloud or local) · Gemini · OpenRouter · Mock adapters behind one interface
    ai/generate.ts        generateStructured(): JSON extraction → Zod validation → 1 retry → ai_logs
    ideas/logic.ts        lenses, prompt, schema, weighted scoring, mock builder (pure)
    copy/logic.ts         copy prompt/schema, field regeneration, QC runner (pure)
    qc.ts                 claim checks, banned phrases, testimonial detection, length/CTA rules
    creative/service.ts   DB workflow: briefs (versioned), ideas, approvals gate, copy versions
    analytics/csv.ts      Meta export parsing: column aliases, row validation, null ≠ 0
    analytics/metrics.ts  metric definitions (ratios from sums), formatting
    analytics/rules.ts    deterministic Media Buyer detection rules with evidence
    analytics/service.ts  import/dedupe, dashboard queries, recommendations, AI insight + figure check
    schema.ts / db.ts     SQLite schema + seed (node:sqlite, WAL)
docs/                     workflow diagrams, published artifacts' source
tests/                    vitest: QC, scoring, CSV, metrics, rules, both demo flows, AI retry/failure
```

**Key decisions and trade-offs**
- **One backend (Next.js server actions)** instead of separate services. It's enough for the prototype. Long media jobs (video, image) would move to a queue worker; see the roadmap.
- **JSON file storage for the MVP.** Data lives in an in-memory SQLite (built into Node) and is saved to a JSON file after every change, so queries stay plain SQL and there's no database to run. Swapping in Turso or Postgres later replaces one file.
- **Provider abstraction plus schema-validated output.** Models change often, so each task has its own prompt, schema and mock, and the provider is set in config. Real-provider failures are shown to the user and **never silently replaced with mock output**.
- **Rules detect, AI explains.** Media Buyer alerts come from deterministic, configurable thresholds (`THRESHOLDS` in `rules.ts`), so the AI can't invent a problem. The AI summary is limited to a fact sheet and checked for unknown figures.
- **Human gates are enforced server-side, not just in the UI.** Copy can't be generated from an unapproved idea, copy with QC errors can't be approved, and any edit creates a new version and resets approval.

## Data model (SQLite)

`clients` → `ad_accounts`, `campaigns` → `briefs` (versioned) → `ideas` (scores, warnings, learnings used, provider) → `copy_variations` (lineage + version, QC, status) · `approvals` (every decision) · `audit_log` · `ai_logs` · `ad_imports` (file hash) → `ad_performance` (daily facts, `row_key` unique, NULL = unavailable) · `recommendations` (evidence, fingerprint unique, learning) · `insights`.

## Metric definitions

Base metrics are summed. Ratios are recomputed from the sums and never averaged: CTR = clicks ÷ impressions, CPC = spend ÷ clicks, CPM = spend ÷ impressions × 1000, cost per result = spend ÷ results, ROAS = conversion value ÷ spend (only when every row has a conversion value). Frequency is the impression-weighted mean of daily frequency, because reach doesn't add up across days. A missing input or a zero denominator shows as "—".

## Security and safety

- API keys are read server-side only and are never sent to the browser. Provider errors are truncated and never echo request bodies.
- The Media Buyer agent has **no write path** to any ad platform. "Accept" only records a decision.
- Unmapped ad accounts are rejected on import rather than guessed, so data can't land on the wrong client.
- Every approval, import, generation and decision is written to `audit_log`.

## Known limitations

- **No authentication.** One reviewer name comes from `DEMO_REVIEWER_NAME`. Production needs SSO, roles (admin, team, reviewer, read-only) and per-client authorisation.
- All nine agents work in the app. Static Creative, UGC Video and Video Editing produce plans, prompts and specs with AI, but **no image or video rendering service is connected**, and their pages say so.
- With the mock provider, ideas and copy are templates. Set `OLLAMA_API_KEY` for real generation. Hosted model IDs change, so check them in `.env.local` before demoing.
- The UI was checked through a production build and route smoke tests. Interactive flows are covered by integration tests against the same service layer, not browser automation.
- Meta data is CSV-only. A read-only Marketing API pull is the day-30 milestone.
- The QC claim checker is heuristic. It points the reviewer at likely problems and doesn't replace review.

## Roadmap

| Milestone | Build | Done when |
|---|---|---|
| Weeks 1–2 | Foundation, Idea Generator, Copywriting, Toast CSV, Media Buyer rules (**this prototype**) | 3 real briefs end to end; at least 50% of ideas rated 4/5+; Toast totals match Ads Manager within 1% |
| Day 30 | Meta API read-only nightly ingest, Slack alerts, Script Writing, Static Creative v1, Postgres + auth | All accounts refresh daily; at least 70% of alerts marked useful; first copy draft in under 10 minutes |
| Day 60 | Video Editing pipeline, Landing Pages, UGC pilot, client reports | Edit time down 50%; 2 pages live via approval; first UGC tests |
| Day 90 | All 9 connected, learning loop, cost dashboard, prompt regression evals, capped write-actions pilot | All 9 used on 2+ live clients; cost per asset tracked |

## Deploying to Vercel

1. Import the repo in Vercel (Next.js is detected automatically).
2. **Add a Turso database** (free): Vercel → your project → Storage / Marketplace → **Turso** → create and connect. This sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Or create one at turso.tech and add both variables yourself.
3. Add `OLLAMA_API_KEY` (and optionally `OLLAMA_MODEL`) in Project → Settings → Environment Variables.
4. Redeploy.

**Why Turso is required on Vercel:** Vercel runs each page and action in separate serverless functions that don't share a disk, so a local file can't hold the data. With Turso set:
- every request loads the latest data and saves its changes back
- saves are merged row by row, so two functions saving at once don't overwrite each other
- locally, without Turso, the app keeps using the JSON file

The AI autopilot runs in the background after the request (`after()`) and publishes its progress after every step, and the pages that start it allow up to 60 seconds (`maxDuration`). On Vercel, generated images are linked from the image service rather than saved.

## Image ads (Static Creative)

The Static Creative agent produces **finished PNG ads** at Meta sizes: 1080×1080, 1080×1350 and 1080×1920.
- The AI writes the concept and image prompt, then an image model generates the picture.
- A template adds the approved headline, description, brand and button, so the text is always sharp.
- Stories/Reels keep clear of the top 14% and bottom 20%.

Image providers:
- **Pollinations** is the default: free, no key, one image every 45 seconds, small watermark. The first concept's image is made automatically; the others have a **Generate image** button.
- **Hugging Face FLUX.1-schnell** is used when `HF_TOKEN` is set: free token, no watermark, and every concept gets its image at once.

On Vercel, images are saved to `/tmp`, so like the JSON store they reset when a fresh instance starts.
