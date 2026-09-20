import type { AiExtraction } from '../facts'

/**
 * The boundary between our reasoning and the language model.
 *
 * Deliberately narrow. A provider may only turn free text into the structured
 * facts the note actually contains. It cannot retrieve codes, rank them,
 * decide confidence, or write the recommendation — all of that is deterministic
 * application logic operating on the approved reference database.
 *
 * This is what makes "never substitute AI memory for the procedure-code
 * database" a structural property rather than a prompt instruction: there is no
 * return path through which a model could deliver a code.
 */
export interface ExtractionRequest {
  text: string
  /** Answers already given to clarifying questions, for context. */
  priorAnswers?: Array<{ question: string; answer: string }>
}

export interface ExtractionUsage {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  costMillicents: number
  latencyMs: number
  success: boolean
  errorCode?: string
}

export interface ExtractionResponse {
  extraction: AiExtraction | null
  usage: ExtractionUsage
}

export interface FactExtractionProvider {
  readonly name: string
  extract(request: ExtractionRequest): Promise<ExtractionResponse>
}
