import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { PROCEDURE_KINDS } from '../vocabulary'
import { AiExtractionSchema, type AiExtraction } from '../facts'
import type {
  ExtractionRequest,
  ExtractionResponse,
  FactExtractionProvider,
} from './provider'
import { logger } from '@/lib/logging/logger'

/**
 * Fact extraction with Claude.
 *
 * Structured outputs rather than free-form JSON parsing: the model is
 * constrained to the schema below, which has no field capable of carrying a
 * procedure code. Even a model determined to volunteer "D2393" has nowhere to
 * put it, and the response would fail validation if it tried.
 *
 * Attributes travel as key/value pairs rather than an open object because a
 * JSON-schema `additionalProperties` map is awkward to constrain strictly.
 */

const MODEL = 'claude-opus-5'

/** Per-million-token rates for the model above, in US dollars. */
const INPUT_RATE_PER_MTOK = 5
const OUTPUT_RATE_PER_MTOK = 25

const AiProcedureOut = z.object({
  procedure_kind: z
    .string()
    .describe('One key from the supplied vocabulary list, or "unknown".'),
  tooth_numbers: z
    .array(z.string())
    .describe('Universal numbers 1-32 or primary letters A-T, exactly as written. Empty if none stated.'),
  surfaces: z
    .array(z.string())
    .describe('Surface letters M, O, D, B, F, L, I. Empty if not stated. Never inferred from the procedure.'),
  materials: z.array(z.string()).describe('Materials explicitly named. Empty if not stated.'),
  existing_restoration: z
    .string()
    .nullable()
    .describe('The existing restoration described as being present, or null.'),
  is_replacement: z
    .boolean()
    .nullable()
    .describe('true if replacing existing work, false if explicitly new, null if not stated.'),
  clinical_reasons: z
    .array(z.string())
    .describe('Clinical findings stated in the text, such as "recurrent decay". Empty if none stated.'),
  image_count: z.number().int().nullable().describe('Number of images, if a number is stated.'),
  quadrants: z.array(z.string()).describe('UR, UL, LL or LR, if stated.'),
  arches: z.array(z.string()).describe('MAXILLARY or MANDIBULAR, if stated.'),
  attributes: z
    .array(z.object({ key: z.string(), value: z.string() }))
    .describe('Other procedure-specific facts stated in the text.'),
  source_text: z.string().describe('The span of the input this procedure came from.'),
})

const AiExtractionOut = z.object({
  procedures: z.array(AiProcedureOut),
  dentition: z.enum(['PERMANENT', 'PRIMARY', 'UNKNOWN']),
  age_band: z.enum(['CHILD', 'ADULT', 'UNKNOWN']),
  ambiguities: z
    .array(z.string())
    .describe('Genuine ambiguities in what was written. Not speculation about what might have happened.'),
})

function vocabularyList(): string {
  return PROCEDURE_KINDS.map((p) => `- ${p.key}: ${p.label}`).join('\n')
}

const SYSTEM_PROMPT = `You extract structured facts from dental treatment descriptions written by dental practice staff. Your output is consumed by a deterministic coding engine.

You have exactly one job: represent what the text says. You do not select, suggest, or mention procedure codes — a separate system retrieves those from an approved database.

Rules, in order of importance:

1. NEVER invent clinical information. If the text does not state a tooth number, surface, material, reason, or count, leave the corresponding field empty or null. An empty field is a correct answer. A plausible guess is a serious error, because a downstream engine will treat what you return as documented fact.

2. NEVER infer surfaces from a procedure name. "Composite on #12" states no surfaces. Do not assume an occlusal surface because a tooth is posterior, or an incisal edge because it is anterior.

3. NEVER output a procedure code (a D-number). No field accepts one. If the user's text contains a code, ignore it — it is not a clinical fact about what was done.

4. Classify each procedure using one key from this vocabulary. If nothing fits, use "unknown":

${vocabularyList()}

5. Split the description into one entry per distinct procedure. "exam bwx cleaning fluoride" is four procedures. Attach each tooth, surface and material to the procedure it belongs to, not to all of them.

6. Report genuine ambiguity in "ambiguities" — wording that could mean two different things. Do not list merely missing information there; missing information is represented by empty fields.

7. Treat abbreviations as dental shorthand: MOD = mesial/occlusal/distal surfaces, BW/BWX = bitewings, SRP = scaling and root planing, RCT = root canal therapy, prophy = prophylaxis, PA = periapical radiograph, FMX = full mouth series.`

export class AnthropicExtractionProvider implements FactExtractionProvider {
  readonly name = 'anthropic'
  private readonly client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async extract(request: ExtractionRequest): Promise<ExtractionResponse> {
    const started = Date.now()

    const context =
      request.priorAnswers && request.priorAnswers.length > 0
        ? `\n\nClarifications already provided by the user:\n${request.priorAnswers
            .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
            .join('\n')}`
        : ''

    try {
      const response = await this.client.messages.parse({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(AiExtractionOut) },
        messages: [
          {
            role: 'user',
            content: `Extract the clinical facts stated in this description:\n\n${request.text}${context}`,
          },
        ],
      })

      const usage = {
        provider: this.name,
        model: MODEL,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        costMillicents: costMillicents(
          response.usage.input_tokens,
          response.usage.output_tokens,
        ),
        latencyMs: Date.now() - started,
        success: true,
      }

      const parsed = response.parsed_output
      if (!parsed) {
        return {
          extraction: null,
          usage: { ...usage, success: false, errorCode: 'UNPARSEABLE' },
        }
      }

      return { extraction: toExtraction(parsed), usage }
    } catch (error) {
      // The pipeline degrades to deterministic extraction rather than failing
      // the request: a rule-based answer beats an error page at the chair.
      const code =
        error instanceof Anthropic.APIError ? `HTTP_${error.status}` : 'PROVIDER_ERROR'
      logger.warn('ai.extraction_failed', { provider: this.name, errorCode: code })
      return {
        extraction: null,
        usage: {
          provider: this.name,
          model: MODEL,
          inputTokens: 0,
          outputTokens: 0,
          costMillicents: 0,
          latencyMs: Date.now() - started,
          success: false,
          errorCode: code,
        },
      }
    }
  }
}

function costMillicents(inputTokens: number, outputTokens: number): number {
  const dollars =
    (inputTokens / 1_000_000) * INPUT_RATE_PER_MTOK +
    (outputTokens / 1_000_000) * OUTPUT_RATE_PER_MTOK
  return Math.round(dollars * 100_000)
}

/** Converts the wire shape into the engine's internal extraction type. */
function toExtraction(parsed: z.infer<typeof AiExtractionOut>): AiExtraction {
  return AiExtractionSchema.parse({
    procedures: parsed.procedures.map((p) => ({
      procedure_kind: p.procedure_kind,
      tooth_numbers: p.tooth_numbers,
      surfaces: p.surfaces,
      materials: p.materials,
      existing_restoration: p.existing_restoration,
      is_replacement: p.is_replacement,
      clinical_reasons: p.clinical_reasons,
      image_count: p.image_count,
      quadrants: p.quadrants,
      arches: p.arches,
      attributes: Object.fromEntries(p.attributes.map((a) => [a.key, a.value])),
      source_text: p.source_text,
    })),
    dentition: parsed.dentition === 'UNKNOWN' ? null : parsed.dentition,
    age_band: parsed.age_band === 'UNKNOWN' ? null : parsed.age_band,
    ambiguities: parsed.ambiguities,
  })
}
