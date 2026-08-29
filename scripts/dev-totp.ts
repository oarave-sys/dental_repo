import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { decryptSecret } from '../src/lib/auth/crypto'
import { Secret, TOTP } from 'otpauth'

/**
 * Prints a current TOTP code for a seeded development account.
 * Development only — it decrypts a stored MFA secret, which no production
 * tooling should ever do.
 */
const email = process.argv[2] ?? 'coordinator@lakeside.example'
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_DATABASE_URL! }),
})

const user = await db.user.findUnique({ where: { email }, select: { mfaSecretEncrypted: true } })
if (!user?.mfaSecretEncrypted) {
  console.error(`No enrolled account for ${email}`)
  process.exit(1)
}
const totp = new TOTP({
  issuer: 'Referral OS',
  label: email,
  secret: Secret.fromBase32(decryptSecret(user.mfaSecretEncrypted)),
})
console.log(`${email}  ->  ${totp.generate()}  (valid ~30s)`)
await db.$disconnect()
