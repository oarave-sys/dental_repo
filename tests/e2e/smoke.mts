/**
 * End-to-end smoke test of the coordinator's critical path, run against a real
 * build in a real browser. Verifies the workflow actually works, not just that
 * the units do.
 *
 * Usage: BASE_URL=http://localhost:3100 npx tsx tests/e2e/smoke.mts
 */
import 'dotenv/config'
import { chromium } from 'playwright'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../src/generated/prisma/client'
import { decryptSecret } from '../../src/lib/auth/crypto'
import { Secret, TOTP } from 'otpauth'

const BASE = process.env.BASE_URL ?? 'http://localhost:3100'
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_DATABASE_URL! }),
})

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function totpFor(email: string): Promise<string> {
  const user = await db.user.findUnique({ where: { email }, select: { mfaSecretEncrypted: true } })
  return new TOTP({
    issuer: 'Referral OS',
    secret: Secret.fromBase32(decryptSecret(user!.mfaSecretEncrypted!)),
  }).generate()
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })

async function signIn(email: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${BASE}/login`)
  await page.fill('input[name="email"]', email)
  await page.fill('input[name="password"]', 'correct-horse-battery-staple')
  await page.click('button[type="submit"]')
  await page.waitForURL('**/mfa', { timeout: 15_000 })
  await page.fill('input[name="code"]', await totpFor(email))
  await page.click('button[type="submit"]')
  await page.waitForURL((u) => !u.pathname.startsWith('/mfa'), { timeout: 15_000 })
  return { context, page }
}

async function clearLockout(email: string) {
  await db.user.update({
    where: { email },
    data: { failedLoginCount: 0, lockedUntil: null },
  })
}

console.log('\nAuthentication')
{
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${BASE}/referrals`)
  check('unauthenticated access redirects to sign-in', page.url().includes('/login'))

  async function attempt(email: string, password: string): Promise<string> {
    await page.goto(`${BASE}/login`)
    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', password)
    await page.click('button[type="submit"]')
    // p[role=alert], not [role=alert]: Next renders its own route announcer
    // with that role, and it is always empty.
    await page.waitForSelector('p[role="alert"]', { timeout: 15_000 })
    return (await page.textContent('p[role="alert"]'))?.trim() ?? ''
  }

  await clearLockout('coordinator@lakeside.example')
  const badPassword = await attempt('coordinator@lakeside.example', 'wrong-password')
  check('a bad password is rejected generically', /incorrect/i.test(badPassword), badPassword)

  const unknownAccount = await attempt('nobody@lakeside.example', 'wrong-password')
  check('an unknown account gives the same message, so users cannot be enumerated',
    unknownAccount === badPassword, unknownAccount)

  // Four more failures reaches the five-attempt threshold.
  let lockMessage = ''
  for (let i = 0; i < 5; i++) {
    lockMessage = await attempt('coordinator@lakeside.example', 'wrong-password')
  }
  check('repeated failures lock the account', /too many attempts/i.test(lockMessage), lockMessage)

  // A locked account rejects even the correct password.
  const whileLocked = await attempt('coordinator@lakeside.example', 'correct-horse-battery-staple')
  check('a locked account rejects the correct password too', /too many attempts/i.test(whileLocked))
  await clearLockout('coordinator@lakeside.example')

  await page.goto(`${BASE}/`)
  check('password alone does not reach the dashboard', page.url().includes('/login'))
  await context.close()
}

console.log('\nCoordinator critical path')
{
  const { context, page } = await signIn('coordinator@lakeside.example')
  check('MFA completes and lands on the dashboard', new URL(page.url()).pathname === '/')

  const heading = await page.textContent('h1')
  check('dashboard shows the exception view', /needs attention/i.test(heading ?? ''))

  await page.click('text=Referrals')
  await page.waitForURL('**/referrals')
  const rows = await page.locator('tbody tr').count()
  check('inbox lists seeded referrals', rows > 5, `${rows} rows`)

  // Only this organization's data appears.
  const body = await page.textContent('body')
  check('no other tenant’s patient appears', !/OtherTenant/.test(body ?? ''))
  check('no other tenant’s referral text appears', !/never be visible/i.test(body ?? ''))

  await page.locator('tbody tr a').first().click()
  await page.waitForURL(/\/referrals\/[0-9a-f-]{36}/)
  check('referral detail opens', true, new URL(page.url()).pathname.slice(0, 24) + '…')

  const detail = await page.textContent('body')
  check('detail shows the timeline', /Activity timeline/i.test(detail ?? ''))
  check('detail shows processing time', /Processing time/i.test(detail ?? ''))

  // The status machine is enforced through the UI.
  const statusCard = page.locator('section').filter({ hasText: 'Move this referral' })
  const statusSelect = statusCard.locator('select').first()
  const values = (await statusSelect.locator('option').evaluateAll(
    (nodes) => nodes.map((n) => (n as HTMLOptionElement).value),
  )).filter(Boolean)
  check('only legal transitions are offered', values.length > 0 && !values.includes('SCHEDULED'),
    values.slice(0, 5).join(', '))

  const referralUrl = page.url()
  await statusSelect.selectOption(values[0]!)
  await page.click('button:has-text("Update")')
  await page.waitForTimeout(3000)
  await page.goto(referralUrl)
  const after = await page.textContent('body')
  check('status change lands on the timeline', /status changed/i.test(after ?? ''))

  await context.close()
}

console.log('\nRole boundaries')
{
  const { context, page } = await signIn('marketing@lakeside.example')
  const nav = await page.textContent('header')
  check('marketing sees no Referrals link', !/Referrals/.test(nav ?? ''))
  check('marketing sees no Patients link', !/Patients/.test(nav ?? ''))
  check('marketing sees referring offices', /Referring offices/.test(nav ?? ''))

  // Hiding the link is not the control — the page itself must refuse.
  await page.goto(`${BASE}/patients`)
  const patientsBody = await page.textContent('body')
  // Hiding the link is not the control: the page itself must refuse, and it
  // must not render any patient the marketing user should never see.
  check('marketing cannot load the patients page',
    /do not have access/i.test(patientsBody ?? '')
      && !/Staging records/i.test(patientsBody ?? '')
      && !/Vance|Delgado|Solberg/.test(patientsBody ?? ''))

  await page.goto(`${BASE}/settings/audit`)
  const auditBody = await page.textContent('body')
  check('marketing cannot load the audit log', !/Append-only/i.test(auditBody ?? ''))
  await context.close()
}

console.log('\nAdministrator')
{
  const { context, page } = await signIn('admin@lakeside.example')
  await page.goto(`${BASE}/settings/audit`)
  const auditRows = await page.locator('tbody tr').count()
  check('audit log is visible and populated', auditRows > 0, `${auditRows} rows`)
  const audit = await page.textContent('body')
  check('audit log contains no patient names', !/Eleanor|Delgado|Solberg/.test(audit ?? ''))
  await context.close()
}

console.log('\nDuplicate detection at intake')
{
  const { context, page } = await signIn('coordinator@lakeside.example')
  await page.goto(`${BASE}/referrals/new`)
  await page.fill('input[name="firstName"]', 'Marcus')
  await page.fill('input[name="lastName"]', 'Delgado')
  await page.fill('input[name="dateOfBirth"]', '1968-11-02')
  await page.locator('input[name="dateOfBirth"]').blur()
  await page.waitForTimeout(2500)
  const intake = await page.textContent('body')
  check('possible existing patient is surfaced', /Possible existing patient/i.test(intake ?? ''))
  check('and it says nothing was merged', /will not merge/i.test(intake ?? ''))
  await context.close()
}

console.log('\nTriage intelligence')
{
  const { context, page } = await signIn('coordinator@lakeside.example')
  await page.goto(`${BASE}/referrals`)

  // The fibromyalgia referral is the practice's RED case.
  await page.click('text=Boyle, Terrence')
  await page.waitForURL(/\/referrals\/[0-9a-f-]{36}/)
  const red = await page.textContent('body')
  check('a fibromyalgia referral shows as not accepted', /Not accepted/i.test(red ?? ''))
  check('and explains why, in the practice’s own words',
    /not accepted as the reason for referral/i.test(red ?? ''))
  check('and shows every dimension, not just the deciding one',
    /DIAGNOSIS/i.test(red ?? '') && /PAYER/i.test(red ?? '') && /DOCUMENTATION/i.test(red ?? ''))
  check('and labels the confidence scores as heuristic',
    /not calibrated probabilities/i.test(red ?? ''))

  // The osteoporosis DXA special rule from the triage guide.
  await page.goto(`${BASE}/referrals`)
  await page.click('text=Vance, Eleanor')
  await page.waitForURL(/\/referrals\/[0-9a-f-]{36}/)
  const incomplete = await page.textContent('body')
  check('an osteoporosis referral without a DXA is incomplete', /Incomplete/i.test(incomplete ?? ''))
  check('and the next action names the missing document', /DXA report/i.test(incomplete ?? ''))
  check('and the diagnosis dimension is still reported as good',
    /Good to schedule/i.test(incomplete ?? ''))

  // Three-state documentation, not a checkbox.
  check('documents offer in-packet / missing / not-checked',
    /In packet/i.test(incomplete ?? '') && /Not checked/i.test(incomplete ?? ''))

  await context.close()
}

console.log('\nRule administration')
{
  const { context, page } = await signIn('admin@lakeside.example')
  await page.goto(`${BASE}/settings/rules`)
  const rules = await page.textContent('body')
  check('the published rule set is listed', /published/i.test(rules ?? ''))
  check('declining rules are marked primary-only', /primary only/i.test(rules ?? ''))
  check('the Medicaid exclusion is shown as a category rule',
    /MEDICAID/i.test(rules ?? '') && /not contracted/i.test(rules ?? ''))
  check('required vs recommended is visible', /required/i.test(rules ?? '') && /recommended/i.test(rules ?? ''))

  await page.goto(`${BASE}/settings/rules/simulator`)
  await page.click('button:has-text("Run simulation")')
  await page.waitForSelector('text=referrals evaluated', { timeout: 30_000 })
  const sim = await page.textContent('body')
  check('the simulator reports how many referrals it evaluated', /referrals evaluated/i.test(sim ?? ''))
  check('and does not name patients', !/Vance|Delgado|Solberg|Boyle/.test(sim ?? ''))
  await context.close()
}

console.log('\nRule administration is administrator-only')
{
  const { context, page } = await signIn('coordinator@lakeside.example')
  await page.goto(`${BASE}/settings/rules`)
  const denied = await page.textContent('body')
  check('a coordinator cannot open the rules screen', /do not have access/i.test(denied ?? ''))
  await context.close()
}

await browser.close()
await db.$disconnect()

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`)
process.exit(failures === 0 ? 0 : 1)
