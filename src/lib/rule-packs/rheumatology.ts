import type { RulePack, RulePackCategory, RulePackRule } from './types'

/**
 * Rheumatology rule pack — the practice's triage guide expressed as data.
 *
 * ICD-10 mapping principle, from docs/ARCHITECTURE.md §6.2: where a condition
 * spans several codes, map the FAMILY or RANGE, never a guessed leaf. Where
 * specificity genuinely depends on information a referral may not contain, the
 * mapping carries a `specificityNote` and the UI shows the candidates side by
 * side rather than inventing precision.
 *
 * These are the organization's STARTING rules. Once installed they belong to
 * the organization and are edited in the admin screens, not here.
 */

const GREEN_CATEGORIES: RulePackCategory[] = [
  {
    key: 'OSTEOPOROSIS',
    name: 'Osteoporosis',
    description: 'Accepted. A DXA report is required before scheduling.',
    sortOrder: 10,
    codeMaps: [
      { matchType: 'CODE_FAMILY', value: 'M80' },
      { matchType: 'CODE_FAMILY', value: 'M81' },
    ],
    synonyms: [
      { term: 'osteoporosis' },
      { term: 'osteoporotic fracture' },
      { term: 'low bone density', weight: 45 },
    ],
  },
  {
    key: 'RHEUMATOID_ARTHRITIS',
    name: 'Rheumatoid Arthritis',
    description: 'Accepted. Expedite when RF or anti-CCP is positive.',
    sortOrder: 20,
    codeMaps: [
      { matchType: 'CODE_FAMILY', value: 'M05', specificityNote: 'Seropositive RA' },
      { matchType: 'CODE_FAMILY', value: 'M06', specificityNote: 'Other RA, including seronegative' },
    ],
    synonyms: [
      { term: 'rheumatoid arthritis' },
      { term: 'seropositive rheumatoid arthritis' },
      { term: 'seronegative rheumatoid arthritis' },
      // Low weight and case-sensitive: "RA" alone corroborates, never establishes.
      { term: 'RA', matchMode: 'ABBREVIATION', weight: 30 },
    ],
  },
  {
    key: 'POLYARTHRITIS',
    name: 'Polyarthritis',
    sortOrder: 30,
    codeMaps: [{ matchType: 'CODE_FAMILY', value: 'M13.0' }],
    synonyms: [{ term: 'polyarthritis' }, { term: 'inflammatory polyarthritis' }],
  },
  {
    key: 'SJOGRENS',
    name: "Sjögren's Syndrome",
    sortOrder: 40,
    codeMaps: [{ matchType: 'CODE_FAMILY', value: 'M35.0' }],
    synonyms: [
      { term: 'sjogren' }, { term: 'sjögren' }, { term: 'sicca syndrome' },
    ],
  },
  {
    key: 'LUPUS',
    name: 'Lupus / SLE',
    sortOrder: 50,
    codeMaps: [
      { matchType: 'CODE_FAMILY', value: 'M32', specificityNote: 'Systemic lupus erythematosus' },
    ],
    synonyms: [
      { term: 'lupus' }, { term: 'systemic lupus erythematosus' },
      { term: 'SLE', matchMode: 'ABBREVIATION', weight: 45 },
    ],
  },
  {
    key: 'RAYNAUDS',
    name: "Raynaud's Phenomenon",
    sortOrder: 60,
    codeMaps: [{ matchType: 'CODE_FAMILY', value: 'I73.0' }],
    synonyms: [{ term: 'raynaud' }, { term: "raynaud's phenomenon" }],
  },
  {
    key: 'VASCULITIS',
    name: 'Vasculitis',
    sortOrder: 70,
    codeMaps: [
      { matchType: 'CODE_FAMILY', value: 'M30' },
      {
        matchType: 'CODE_FAMILY', value: 'M31', weight: 80,
        specificityNote: 'Other necrotising vasculopathies. Giant cell arteritis sits inside M31 and maps more specifically.',
      },
    ],
    synonyms: [{ term: 'vasculitis' }, { term: 'polyarteritis' }, { term: 'ANCA', matchMode: 'ABBREVIATION', weight: 35 }],
  },
  {
    key: 'SARCOIDOSIS',
    name: 'Sarcoidosis',
    sortOrder: 80,
    codeMaps: [{ matchType: 'CODE_FAMILY', value: 'D86' }],
    synonyms: [{ term: 'sarcoidosis' }, { term: 'sarcoid' }],
  },
  {
    key: 'SCLERODERMA',
    name: 'Scleroderma / Systemic Sclerosis',
    sortOrder: 90,
    codeMaps: [{ matchType: 'CODE_FAMILY', value: 'M34' }],
    synonyms: [
      { term: 'scleroderma' }, { term: 'systemic sclerosis' },
      { term: 'CREST syndrome' },
    ],
  },
  {
    key: 'ANKYLOSING_SPONDYLITIS',
    name: 'Ankylosing Spondylitis',
    sortOrder: 100,
    codeMaps: [{ matchType: 'CODE_FAMILY', value: 'M45' }],
    synonyms: [
      { term: 'ankylosing spondylitis' }, { term: 'axial spondyloarthritis' },
      { term: 'AS', matchMode: 'ABBREVIATION', weight: 20 },
    ],
  },
  {
    key: 'POLYMYALGIA_RHEUMATICA',
    name: 'Polymyalgia Rheumatica',
    sortOrder: 110,
    codeMaps: [{ matchType: 'EXACT_CODE', value: 'M35.3' }],
    synonyms: [
      { term: 'polymyalgia rheumatica' }, { term: 'polymyalgia' },
      { term: 'PMR', matchMode: 'ABBREVIATION', weight: 50 },
    ],
  },
  {
    key: 'GIANT_CELL_ARTERITIS',
    name: 'Giant Cell Arteritis / Temporal Arteritis',
    description: 'Accepted. Treat as urgent — sight-threatening if untreated.',
    sortOrder: 120,
    codeMaps: [
      {
        matchType: 'EXACT_CODE', value: 'M31.6',
        specificityNote: 'Other giant cell arteritis, without polymyalgia rheumatica',
      },
      {
        matchType: 'EXACT_CODE', value: 'M31.5',
        specificityNote: 'Giant cell arteritis with polymyalgia rheumatica. Which of M31.5 and M31.6 applies depends on whether PMR is documented — both are shown when it is not.',
      },
    ],
    synonyms: [
      { term: 'giant cell arteritis' }, { term: 'temporal arteritis' },
      { term: 'GCA', matchMode: 'ABBREVIATION', weight: 50 },
    ],
  },
  {
    key: 'MCTD',
    name: 'Mixed Connective Tissue Disease',
    sortOrder: 130,
    codeMaps: [{ matchType: 'EXACT_CODE', value: 'M35.1' }],
    synonyms: [
      { term: 'mixed connective tissue disease' },
      { term: 'MCTD', matchMode: 'ABBREVIATION', weight: 50 },
      { term: 'undifferentiated connective tissue disease', weight: 40 },
    ],
  },
  {
    key: 'POLYMYOSITIS',
    name: 'Polymyositis',
    sortOrder: 140,
    codeMaps: [
      { matchType: 'CODE_FAMILY', value: 'M33', specificityNote: 'Dermatopolymyositis group; M33.2 is polymyositis specifically.' },
    ],
    synonyms: [
      { term: 'polymyositis' }, { term: 'dermatomyositis' },
      { term: 'inflammatory myopathy', weight: 50 },
    ],
  },
  {
    key: 'GOUT',
    name: 'Gout',
    sortOrder: 150,
    codeMaps: [{ matchType: 'CODE_FAMILY', value: 'M10' }],
    synonyms: [
      { term: 'gout' }, { term: 'gouty arthritis' }, { term: 'tophaceous gout' },
      { term: 'hyperuricemia', weight: 35 },
    ],
  },
  {
    key: 'PSORIATIC_ARTHRITIS',
    name: 'Psoriatic Arthritis',
    sortOrder: 155,
    codeMaps: [{ matchType: 'CODE_FAMILY', value: 'L40.5' }],
    synonyms: [
      { term: 'psoriatic arthritis' },
      { term: 'PsA', matchMode: 'ABBREVIATION', weight: 45 },
    ],
  },
  {
    key: 'IBD_ARTHROPATHY',
    name: "Joint pain with ulcerative colitis or Crohn's disease",
    sortOrder: 160,
    codeMaps: [
      { matchType: 'EXACT_CODE', value: 'M07.4', specificityNote: "Arthropathy in Crohn's disease" },
      { matchType: 'EXACT_CODE', value: 'M07.5', specificityNote: 'Arthropathy in ulcerative colitis' },
    ],
    synonyms: [
      { term: 'enteropathic arthritis' },
      { term: 'arthritis with crohn' },
      { term: 'arthritis with ulcerative colitis' },
    ],
  },
  {
    key: 'POLYARTHRALGIA',
    name: 'Polyarthralgia',
    description: 'Accepted from configured referral sources; otherwise physician review.',
    sortOrder: 170,
    codeMaps: [
      {
        matchType: 'CODE_FAMILY', value: 'M25.5', weight: 70,
        specificityNote: 'Joint pain codes are site-specific; polyarthralgia has no single code and may be recorded as M25.50 or per joint.',
      },
    ],
    synonyms: [{ term: 'polyarthralgia' }, { term: 'multiple joint pain' }],
  },
]

const YELLOW_CATEGORIES: RulePackCategory[] = [
  {
    key: 'OSTEOARTHRITIS',
    name: 'Osteoarthritis',
    sortOrder: 200,
    codeMaps: [{ matchType: 'CODE_RANGE', value: 'M15', valueTo: 'M19' }],
    synonyms: [
      { term: 'osteoarthritis' }, { term: 'degenerative joint disease' },
      { term: 'DJD', matchMode: 'ABBREVIATION', weight: 40 },
      { term: 'OA', matchMode: 'ABBREVIATION', weight: 25 },
    ],
  },
  {
    key: 'OSTEOPENIA',
    name: 'Osteopenia',
    sortOrder: 210,
    codeMaps: [
      {
        matchType: 'CODE_FAMILY', value: 'M85.8',
        specificityNote: 'Osteopenia is recorded under "other specified disorders of bone density and structure" and is site-specific.',
      },
    ],
    synonyms: [{ term: 'osteopenia' }, { term: 'low bone mass' }],
  },
  {
    key: 'JOINT_PAIN_UNSPECIFIED',
    name: 'Joint pain, unspecified',
    sortOrder: 220,
    codeMaps: [{ matchType: 'CODE_FAMILY', value: 'M25.5', weight: 60 }],
    synonyms: [{ term: 'joint pain' }, { term: 'arthralgia' }],
  },
  {
    key: 'SYMPTOMS_ONLY',
    name: 'Symptoms only, no diagnosis',
    sortOrder: 230,
    codeMaps: [],
    synonyms: [
      { term: 'fatigue' }, { term: 'myalgia' }, { term: 'generalized pain' },
      { term: 'positive ANA', weight: 55 },
    ],
  },
  {
    key: 'LYMPHADENOPATHY',
    name: 'Lymphadenopathy',
    sortOrder: 240,
    codeMaps: [{ matchType: 'CODE_FAMILY', value: 'R59' }],
    synonyms: [{ term: 'lymphadenopathy' }, { term: 'swollen lymph nodes' }],
  },
]

const RED_CATEGORIES: RulePackCategory[] = [
  {
    key: 'FIBROMYALGIA',
    name: 'Fibromyalgia',
    description: 'Not accepted as a reason for referral. Common as a comorbidity and not blocking when it is not the primary diagnosis.',
    sortOrder: 300,
    codeMaps: [{ matchType: 'EXACT_CODE', value: 'M79.7' }],
    synonyms: [
      { term: 'fibromyalgia' }, { term: 'fibromyositis' },
      { term: 'FM', matchMode: 'ABBREVIATION', weight: 20 },
    ],
  },
  {
    key: 'EHLERS_DANLOS',
    name: 'Ehlers-Danlos Syndrome',
    sortOrder: 310,
    codeMaps: [
      {
        matchType: 'CODE_FAMILY', value: 'Q79.6',
        specificityNote: 'Ehlers-Danlos subtypes are distinguished within Q79.6 and the subtype is often undocumented on a referral.',
      },
    ],
    synonyms: [
      { term: 'ehlers-danlos' }, { term: 'ehlers danlos' },
      { term: 'EDS', matchMode: 'ABBREVIATION', weight: 40 },
    ],
  },
  {
    key: 'HYPERMOBILITY',
    name: 'Hypermobility',
    sortOrder: 320,
    codeMaps: [{ matchType: 'EXACT_CODE', value: 'M35.7', specificityNote: 'Hypermobility syndrome' }],
    synonyms: [{ term: 'hypermobility' }, { term: 'joint hypermobility syndrome' }],
  },
  {
    key: 'BRONCHOSPASM',
    name: 'Bronchospasm',
    sortOrder: 330,
    codeMaps: [{ matchType: 'CODE_FAMILY', value: 'J98.01' }],
    synonyms: [{ term: 'bronchospasm' }],
  },
  {
    key: 'PRIMARY_HYPERTENSION',
    name: 'Primary hypertension',
    sortOrder: 340,
    codeMaps: [{ matchType: 'EXACT_CODE', value: 'I10' }],
    synonyms: [{ term: 'essential hypertension' }, { term: 'primary hypertension' }],
  },
  {
    key: 'THALASSEMIA',
    name: 'Thalassemia',
    sortOrder: 350,
    codeMaps: [{ matchType: 'CODE_FAMILY', value: 'D56' }],
    synonyms: [{ term: 'thalassemia' }, { term: 'thalassaemia' }],
  },
  {
    key: 'AUTOIMMUNE_THYROIDITIS',
    name: 'Autoimmune thyroiditis',
    sortOrder: 360,
    codeMaps: [{ matchType: 'EXACT_CODE', value: 'E06.3', specificityNote: 'Autoimmune (Hashimoto) thyroiditis' }],
    synonyms: [{ term: 'hashimoto' }, { term: 'autoimmune thyroiditis' }],
  },
  {
    key: 'TRIGGER_FINGER',
    name: 'Trigger finger',
    sortOrder: 370,
    codeMaps: [{ matchType: 'CODE_FAMILY', value: 'M65.3' }],
    synonyms: [{ term: 'trigger finger' }, { term: 'stenosing tenosynovitis' }],
  },
]

/**
 * Every RED rule requires the category to be the PRIMARY diagnosis, affirmed,
 * and matched by a code rather than a passing mention. This is the safety
 * property from docs/ARCHITECTURE.md §5.5, confirmed with the practice: a
 * packet for a rheumatoid arthritis patient will frequently mention
 * fibromyalgia somewhere, and that must never turn the referral away.
 */
function redRule(category: RulePackCategory, priority: number): RulePackRule {
  return {
    dimension: 'DIAGNOSIS',
    name: `${category.name} — not accepted`,
    priority,
    condition: {
      type: 'DIAGNOSIS_CATEGORY',
      categoryKey: category.key,
      position: 'PRIMARY',
      minConfidence: 60,
      allowedContexts: ['REFERRAL_REASON', 'ASSESSMENT_PLAN', 'ENCOUNTER_DIAGNOSIS'],
      allowedPolarities: ['AFFIRMED'],
    },
    outcome: 'RED',
    blocking: true,
    rationale: `${category.name} is not accepted as the reason for referral by this practice.`,
  }
}

function greenRule(category: RulePackCategory, priority: number): RulePackRule {
  return {
    dimension: 'DIAGNOSIS',
    name: `${category.name} — accepted`,
    priority,
    condition: {
      type: 'DIAGNOSIS_CATEGORY',
      categoryKey: category.key,
      position: 'PRIMARY',
      minConfidence: 0,
      allowedPolarities: ['AFFIRMED'],
    },
    outcome: 'GREEN',
    rationale: `${category.name} is accepted by this practice.`,
  }
}

function yellowRule(category: RulePackCategory, priority: number): RulePackRule {
  return {
    dimension: 'DIAGNOSIS',
    name: `${category.name} — physician review`,
    priority,
    condition: {
      type: 'DIAGNOSIS_CATEGORY',
      categoryKey: category.key,
      position: 'PRIMARY',
      minConfidence: 0,
      allowedPolarities: ['AFFIRMED'],
    },
    outcome: 'YELLOW',
    rationale: `${category.name} goes to the physician for a decision.`,
  }
}

export const rheumatologyRulePack: RulePack = {
  key: 'rheumatology',
  name: 'Rheumatology',
  specialty: 'RHEUMATOLOGY',
  version: '1.0.0',
  notes:
    'Initial rules converted from the practice triage guide. Owned by the ' +
    'organization once installed and edited in Settings, not in code.',

  categories: [...GREEN_CATEGORIES, ...YELLOW_CATEGORIES, ...RED_CATEGORIES],

  rules: [
    // RED first by priority so a red primary is never masked by a green rule
    // matching a different category. Precedence would catch it anyway; this
    // makes the intent legible in the rule list.
    ...RED_CATEGORIES.map((c, i) => redRule(c, 10 + i)),
    ...GREEN_CATEGORIES.map((c, i) => greenRule(c, 100 + i)),
    ...YELLOW_CATEGORIES.map((c, i) => yellowRule(c, 200 + i)),

    // Current and former patients go to the physician regardless of diagnosis.
    {
      dimension: 'PATIENT_STATUS',
      name: 'Existing rheumatology patient',
      priority: 50,
      condition: { type: 'PATIENT_STATUS', values: ['CURRENT_PATIENT', 'FORMER_PATIENT'] },
      outcome: 'REVIEW',
      rationale: 'A current or former patient of the practice — route to the physician.',
      actions: [{ type: 'FLAG_PHYSICIAN_REVIEW' }],
    },

    // Expedite, not a different disposition: RA is accepted either way.
    {
      dimension: 'ORG_EXCEPTION',
      name: 'Rheumatoid arthritis — expedite when serology is positive',
      priority: 60,
      condition: {
        type: 'ALL_OF',
        of: [
          { type: 'DIAGNOSIS_CATEGORY', categoryKey: 'RHEUMATOID_ARTHRITIS', position: 'PRIMARY' },
          { type: 'NOT', of: { type: 'REQUIREMENT_MISSING', keys: ['RF'] } },
        ],
      },
      outcome: 'NO_EFFECT',
      rationale: 'Rheumatoid arthritis with serology on file — schedule sooner.',
      actions: [{ type: 'SET_PRIORITY', params: { priority: 'EXPEDITE' } }],
    },
    {
      dimension: 'ORG_EXCEPTION',
      name: 'Giant cell arteritis — expedite',
      priority: 55,
      condition: {
        type: 'DIAGNOSIS_CATEGORY', categoryKey: 'GIANT_CELL_ARTERITIS', position: 'PRIMARY',
      },
      outcome: 'NO_EFFECT',
      rationale: 'Giant cell arteritis is sight-threatening if untreated — schedule urgently.',
      actions: [{ type: 'SET_PRIORITY', params: { priority: 'EXPEDITE' } }],
    },
  ],

  requirements: [
    // General — apply to every referral.
    { key: 'REFERRAL_ORDER', label: 'Referral or order', level: 'REQUIRED', sortOrder: 10,
      detector: { terms: ['referral', 'order', 'consult request'] } },
    { key: 'DEMOGRAPHICS', label: 'Demographic sheet', level: 'REQUIRED', sortOrder: 20,
      detector: { terms: ['date of birth', 'demographics', 'patient information'] } },
    { key: 'OFFICE_NOTES', label: 'Recent office notes', level: 'REQUIRED', sortOrder: 30,
      detector: { terms: ['office visit', 'progress note', 'assessment and plan'] } },
    { key: 'INSURANCE_CARD', label: 'Insurance card', level: 'RECOMMENDED', sortOrder: 40,
      detector: { terms: ['member id', 'insurance', 'subscriber'] } },

    // Osteoporosis: the special rule from the triage guide. DXA is REQUIRED,
    // so a missing one produces INCOMPLETE and a records request rather than a
    // scheduled appointment.
    { key: 'DXA_REPORT', label: 'DXA report', level: 'REQUIRED',
      appliesToCategoryKey: 'OSTEOPOROSIS', sortOrder: 50,
      detector: { terms: ['DXA', 'DEXA', 'dual-energy x-ray absorptiometry', 'bone mineral density', 'T-score', 'BMD'] } },

    // Diagnosis-specific, recommended rather than required: these are useful to
    // have, but a generic clinical suggestion is not practice policy and must
    // not hold up a patient.
    { key: 'RF', label: 'Rheumatoid factor', level: 'RECOMMENDED',
      appliesToCategoryKey: 'RHEUMATOID_ARTHRITIS', sortOrder: 60,
      detector: { terms: ['rheumatoid factor', 'RF'] } },
    { key: 'CCP', label: 'Anti-CCP antibody', level: 'RECOMMENDED',
      appliesToCategoryKey: 'RHEUMATOID_ARTHRITIS', sortOrder: 70,
      detector: { terms: ['anti-CCP', 'CCP antibody', 'cyclic citrullinated'] } },
    { key: 'ESR_CRP', label: 'ESR or CRP', level: 'RECOMMENDED',
      appliesToCategoryKey: 'RHEUMATOID_ARTHRITIS', sortOrder: 80,
      detector: { terms: ['ESR', 'sedimentation rate', 'CRP', 'c-reactive protein'] } },
    { key: 'URIC_ACID', label: 'Serum uric acid', level: 'RECOMMENDED',
      appliesToCategoryKey: 'GOUT', sortOrder: 90,
      detector: { terms: ['uric acid', 'urate'] } },
    { key: 'RENAL_FUNCTION', label: 'Renal function', level: 'RECOMMENDED',
      appliesToCategoryKey: 'GOUT', sortOrder: 100,
      detector: { terms: ['creatinine', 'eGFR', 'renal function', 'BMP', 'CMP'] } },
  ],

  payerRules: [
    /**
     * The practice does not accept Medicaid. Written as CATEGORY rules rather
     * than per-plan, so a Medicaid plan added later inherits the policy instead
     * of quietly defaulting to accepted.
     *
     * A payer RED never auto-communicates anything to a patient or a referring
     * office, and never generates a denial of care — it routes to a human with
     * the contractual reason shown (docs/OPEN-QUESTIONS.md A-5).
     */
    {
      payerCategory: 'MEDICAID',
      outcome: 'RED',
      rationale: 'Not accepted — the practice is not contracted with Medicaid. Review required.',
    },
    {
      payerCategory: 'MEDICAID_MANAGED',
      outcome: 'RED',
      rationale: 'Not accepted — the practice is not contracted with managed Medicaid plans. Review required.',
    },
  ],

  settings: {
    // An unidentifiable diagnosis goes to a person, not to a silent "unknown"
    // bucket nobody works.
    unknownBehavior: 'YELLOW',
    diagnosisConfidenceFloor: 55,
    contestedMargin: 12,
  },
}
