import { AnthropicExtractionProvider } from './anthropic'
import type { FactExtractionProvider } from './provider'

export * from './provider'
export { AnthropicExtractionProvider } from './anthropic'

let override: FactExtractionProvider | null = null
let overridden = false

/**
 * The extraction provider, or null when no API key is configured.
 *
 * Null is a supported state, not a broken one: the engine runs its
 * deterministic extractor either way and simply loses help with prose it
 * cannot parse by rule. The UI says so plainly rather than pretending.
 *
 * Required environment variable: ANTHROPIC_API_KEY.
 */
export function extractionProvider(): FactExtractionProvider | null {
  if (overridden) return override
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  return new AnthropicExtractionProvider(key)
}

/** Tests inject a stub, or explicitly disable the provider. */
export function setExtractionProvider(provider: FactExtractionProvider | null): void {
  override = provider
  overridden = true
}

export function clearExtractionProviderOverride(): void {
  override = null
  overridden = false
}

export function aiConfigured(): boolean {
  return overridden ? override !== null : Boolean(process.env.ANTHROPIC_API_KEY)
}
