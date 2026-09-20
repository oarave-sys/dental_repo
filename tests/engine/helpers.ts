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

export function allText(result: CodingResult): string {
  return JSON.stringify(result).toLowerCase()
}
