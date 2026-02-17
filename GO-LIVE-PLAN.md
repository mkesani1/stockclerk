# StockClerk Go-Live Plan

## Completed (this session)

### 1. Forgot Password Flow
- **Backend**: `POST /api/auth/forgot-password` and `POST /api/auth/reset-password` routes
- **Frontend**: `/forgot-password` and `/reset-password` pages
- **Database**: `password_reset_tokens` table created in Supabase
- **Email**: Sends reset link via Resend (1-hour expiry, single-use tokens)
- Files: `auth.ts`, `ForgotPassword.tsx`, `ResetPassword.tsx`, `email.ts`

### 2. Email Integration (Resend)
- Service at `packages/backend/src/services/email.ts`
- Templates: password reset, welcome email, low stock alert
- Welcome email sent automatically on registration
- Config: `RESEND_API_KEY` and `EMAIL_FROM` env vars
- Gracefully degrades if no API key configured

### 3. Rate Limiting
- Global: 100 requests/minute per IP via `@fastify/rate-limit`
- Added to backend startup

### 4. Security Headers (Vercel)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`

### 5. Onboarding Flow (reviewed)
- 6-step flow is functional for Eposnow and Deliveroo
- Known issues (non-blocking): buffer stock not persisted, Wix OAuth auth conflict
- Completion endpoint works correctly

---

## Needs Your Action

### 6. Install Dependencies & Push
```bash
cd ~/stockclerk
git pull  # sync with remote
# Copy changes from workspace (see instructions below)
npm install  # installs resend, @fastify/rate-limit
git add -A && git commit -m "Add forgot password, email, rate limiting, security headers"
git push origin main
```

### 7. Set Up Resend (Email Service)
1. Sign up at https://resend.com
2. Add and verify your domain `stockclerk.ai`
3. Get your API key
4. Add to Railway environment variables:
   - `RESEND_API_KEY=re_xxxxxxxxx`
   - `EMAIL_FROM=StockClerk <noreply@stockclerk.ai>`
   - `FRONTEND_URL=https://www.stockclerk.ai`

### 8. LGHP Customer Account
- Need details: What is LGHP? Business name, contact email, etc.
- Once provided, I can create the tenant and user in Supabase

### 9. Clean Up Railway Postgres
- The Railway Postgres database is unused (backend connects to Supabase)
- Option A: Remove it from Railway to save costs
- Option B: Keep it as backup/staging

---

## Pre-Launch Checklist

- [ ] Push code changes to GitHub
- [ ] Verify Vercel deployment succeeds
- [ ] Set up Resend and add API key to Railway
- [ ] Test forgot password flow end-to-end
- [ ] Test new user registration (welcome email)
- [ ] Set up LGHP customer account
- [ ] Remove or repurpose Railway Postgres
- [ ] Verify Stripe keys are configured for billing
- [ ] Test onboarding flow with a fresh account
