# AI Invoice Maker

Turn job photos into professional estimates for Canadian contractors. Plan → Execute → Refine → Seal.

## Features

- **Plan**: Create projects with address, province, sqft, job description. Upload photos.
- **Execute**: AI analyzes photos (room, surface type, tasks, materials) and generates scope.
- **Refine**: Edit tags, quantities, materials. Re-run AI with targeted prompts.
- **Estimate**: Province-aware pricing (labor, materials, tax).
- **Real Estate**: Quick comparables search and estimated value add from your renovation. Uses OpenAI; optional Tavily API for web search.
- **Seal**: Lock the estimate and export as HTML (print to PDF).

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment**
   - Copy `.env.example` to `.env.local`
   - Add `OPENAI_API_KEY` (required for AI analysis)
   - `DATABASE_URL` defaults to SQLite (`file:./prisma/dev.db`) for local dev

3. **Initialize database**
   ```bash
   npx prisma migrate dev
   ```

4. **Run dev server**
   ```bash
   npm run dev
   ```

5. Open http://localhost:3000, sign in with any email, create a project, upload photos, run AI analysis.

## Tech Stack

- Next.js 16 (App Router)
- Prisma (SQLite for dev; PostgreSQL for production)
- Tailwind CSS + shadcn/ui
- NextAuth (credentials)
- OpenAI (vision + chat for tagging and scope)

## Deployment Checklist

- [ ] Set `DATABASE_URL` to PostgreSQL (e.g. Neon, Supabase)
- [ ] Set `NEXTAUTH_SECRET` (e.g. `openssl rand -base64 32`)
- [ ] Set `NEXTAUTH_URL` to your production URL
- [ ] Set `OPENAI_API_KEY`
- [ ] Optional: ensure `OPENAI_API_KEY` is set to enable web-search-backed estimate and comparable analysis
- [ ] Optional: Configure S3/R2 for photo storage (omit to use local `public/uploads`)
- [ ] Run `npx prisma migrate deploy`

## Project Structure

```
app/
  (dashboard)/projects/     # Projects list and detail
  api/
    ai/analyze             # Photo tagging + scope synthesis
    real-estate/comparables # Value add + comparables (OpenAI + optional Tavily)
    estimates/generate     # Province-aware pricing
    estimates/seal         # Lock estimate
    invoices/export        # HTML export
    photos/upload
    projects
    scope
components/
  scope/ScopeEditor
  pricing/PricingBreakdown
  invoice/InvoicePreview
lib/
  ai/prompts/
  pricing/canadaPricingEngine.ts
```

## Canadian Pricing

Province-specific labor rates, material multipliers, and tax (GST/HST/PST) are seeded. Edit `lib/pricing/canadaPricingEngine.ts` to adjust baselines.
