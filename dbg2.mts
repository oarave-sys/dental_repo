import 'dotenv/config'
import { chromium } from 'playwright'
const BASE = 'http://localhost:3100'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await b.newContext()).newPage()
p.on('console', (m) => console.log('  [console]', m.type(), m.text().slice(0, 200)))
await p.goto(`${BASE}/login`)
await p.fill('input[name="email"]', 'coordinator@lakeside.example')
await p.fill('input[name="password"]', 'correct-horse-battery-staple')
await p.click('button[type="submit"]')
await p.waitForTimeout(4000)
console.log('URL after submit:', p.url())
const alert = await p.locator('[role="alert"]').count()
if (alert) console.log('alert:', await p.textContent('[role="alert"]'))
console.log('body head:', (await p.textContent('body'))?.slice(0, 200).replace(/\s+/g,' '))
await b.close()
