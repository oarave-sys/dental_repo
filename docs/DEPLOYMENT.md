# Deploying to Vercel

The repository is ready to deploy. Four things were needed to make it so, and
all are already done:

| Needed | Why | Where |
| --- | --- | --- |
| `prisma generate` before `next build` | the generated client is gitignored, so it does not exist in a fresh checkout | `package.json` → `build` |
| `serverExternalPackages` | `@node-rs/argon2` ships a platform-specific `.node` binary and the Prisma adapters open real sockets; bundling either fails at **runtime**, not build time | `next.config.mjs` |
| A pooled database URL | serverless functions open a connection per invocation and will exhaust a direct Postgres connection limit | environment, below |
| Migrations run outside the build | the build has no DDL rights, and running migrations per deploy is a good way to lose a database | run them yourself, below |

---

## 1. Connect the repository

In the Vercel dashboard: **Add New → Project → Import** this repository, and
select the branch you want deployed. Framework detection picks up Next.js; the
build command in `package.json` is already correct, so **change nothing** on
that screen.

## 2. Provision a database

Any Postgres works. Vercel Postgres, Neon and Supabase all do.

You need **two** URLs:

- a **pooled** one for the application (`DATABASE_URL`)
- a **direct** one for migrations (`DIRECT_DATABASE_URL`)

Using the direct URL for the application will work in testing and then exhaust
connections under real load, which is a miserable way to discover the
distinction.

| Provider | Pooled | Direct |
| --- | --- | --- |
| Supabase | the connection **pooler** URI (port 6543) | the direct URI (port 5432) |
| Neon | the **pooled** connection string (`-pooler` host) | the unpooled string |
| Vercel Postgres | `POSTGRES_PRISMA_URL` | `POSTGRES_URL_NON_POOLING` |

### The two roles

The security model assumes the application connects as a role that is **not** a
superuser and does **not** hold `BYPASSRLS`. On a managed provider you often
get one superuser-ish role by default, so create a second:

```sql
CREATE ROLE dental_app LOGIN PASSWORD '<strong password>';
GRANT USAGE ON SCHEMA public TO dental_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dental_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dental_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dental_app;
```

Point `DATABASE_URL` at `dental_app` and `DIRECT_DATABASE_URL` at the owner.

If you skip this, row-level security still exists but does nothing, because the
owner bypasses it. `tests/integration/tenant-isolation.test.ts` asserts the
role requirement and fails loudly if it is not met — run it against production
once, then never worry about it again.

## 3. Set environment variables

In **Project → Settings → Environment Variables**:

| Variable | Value | Required |
| --- | --- | --- |
| `SESSION_SECRET` | `openssl rand -base64 32` | **yes** |
| `DATABASE_URL` | the **pooled** URL, as `dental_app` | for accounts and history |
| `DIRECT_DATABASE_URL` | the **direct** URL, as the owner | for migrations |
| `ANTHROPIC_API_KEY` | your key | for free-text notes |
| `APP_URL` | `https://<your-domain>` | for invitation and reset links |

Set them for Production, Preview and Development as appropriate. **Use a
different database for Preview** — preview branches otherwise write to
production.

None of these is exposed to the browser. There is no `NEXT_PUBLIC_*` variable
in the project, which is deliberate: the Anthropic key is read only in server
code.

## 4. Run migrations and load the code dataset

From your machine, pointed at the production database — **not** from the build:

```bash
export DIRECT_DATABASE_URL="<direct url>"
export DATABASE_URL="<pooled url>"

npm run db:deploy                                          # apply migrations
npm run codes:import -- data/demo-dataset/general-dentistry.json --activate
```

The second command is what makes the tools work: without an active dataset the
engine has nothing to retrieve from and says so. Replace the demo file with
your licensed CDT dataset when you have one (see the README).

Do **not** add `prisma migrate deploy` to the build command. The build runs on
every push, including previews, and a failed migration mid-deploy is much
harder to recover from than a deliberate one you ran and watched.

## 5. Create your account

Visit `https://<your-domain>/sign-up` and create the practice. The first user
becomes the owner.

To reach `/admin`, set the platform-admin flag directly — there is deliberately
no UI that can grant it:

```sql
UPDATE users SET "isPlatformAdmin" = true WHERE email = 'you@example.com';
```

---

## Known limits on serverless

**Cold starts.** Argon2id is intentionally slow, which is the point of it for
password hashing, and a cold Lambda makes the first sign-in of an idle period
feel slow. Subsequent requests are warm. Do not "fix" this by weakening the
hash parameters.

**Connection count.** Every concurrent invocation may hold a connection. The
pooled URL is what keeps this survivable; the Prisma client is cached on
`globalThis` so a warm invocation reuses its connection.

**Long notes.** A Documentation Check on a long note with the model connected
can approach the default function timeout on Hobby (10s). If you hit it, raise
`maxDuration` on the route or move to a plan with a longer limit. Without an
API key the rules engine returns in milliseconds and this cannot happen.

**Regions.** Put the functions in the same region as the database. A
cross-continent round trip per query is the single easiest way to make this
feel slow.

## What is not wired up

Deploying does not change these — they are the same gaps listed in the README:

- **Stripe.** No payment is collected; every practice is on a trial.
- **Email.** Invitation and password-reset links are shown to the inviter in
  the UI and printed to the server log in development. On Vercel, that means
  the invite link appears in the UI and nowhere else, so an admin has to pass
  it on by hand until a mail provider is connected.
- **Rate limiting.** Add it before the sign-in route is publicly reachable for
  long.
