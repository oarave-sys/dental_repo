import { MemoryCodeRepository } from '@/lib/codes/memory-repository'
import { analyse, type AnalyseOptions } from '@/lib/coding/pipeline'
import type { CodingResult } from '@/lib/coding/result'

/**
 * The engine tests run against the demo dataset in memory: no database, no
 * API key, no network. That is deliberate — the reasoning is deterministic, so
 * the tests should be too, and a test suite that needs credentials is a test
 * suite that stops being run.
 */
export const repository = MemoryCodeRepository.demo()

/** Analyse with the language model disabled, exercising the rule path only. */
export async function run(
  input: string,
  options: Omit<AnalyseOptions, 'repository' | 'useAi'> = {},
): Promise<CodingResult> {
  const { result } = await analyse(input, { ...options, repository, useAi: false })
  return result
}

export function codesOf(result: CodingResult): string[] {
  return result.recommendedCodes.map((c) => c.code)
}

export function questionKeys(result: CodingResult): string[] {
  return result.followUpQuestions.map((q) => q.factKey)
}

/**
 * Everything the ENGINE produced, lowercased.
 *
 * `evidence.source` is excluded deliberately: it is the user's own text echoed
 * back so the UI can highlight it, so anything they typed themselves appears
 * there by design. Including it would make "the engine never emits code X"
 * untestable the moment a user types X — which is exactly the case these tests
 * care about most.
 */
export function allText(result: CodingResult): string {
  const { evidence, ...engineOutput } = result
  return JSON.stringify({
    ...engineOutput,
    // Keep the attribution keys; drop only the echoed source text.
    evidence: { segments: evidence.segments.map((s) => s.factKeys) },
  }).toLowerCase()
}
