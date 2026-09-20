import type { Tool } from '@/lib/usage'

/**
 * The tool registry.
 *
 * Every surface that lists the tools — the dashboard, the sidebar, the mobile
 * nav — reads this one array. Adding Claim Scrubber means adding an entry here
 * and a route; nothing else needs to learn about it, and nothing can drift out
 * of sync because there is only one list.
 *
 * `status: 'PLANNED'` renders the card in a clearly unavailable state rather
 * than as a button that does nothing.
 */
export interface ToolDefinition {
  key: Tool
  href: string
  name: string
  /** The one line shown on the dashboard card. */
  tagline: string
  description: string
  status: 'AVAILABLE' | 'PLANNED'
  icon: 'search' | 'check' | 'document' | 'shield'
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    key: 'FIND_CODE',
    href: '/find-a-code',
    name: 'Find a Code',
    tagline: 'Describe what you did.',
    description:
      'Describe the procedure in your own words. We identify the likely code, show the facts we used, and ask if something is missing.',
    status: 'AVAILABLE',
    icon: 'search',
  },
  {
    key: 'CHECK_CODE',
    href: '/check-a-code',
    name: 'Check a Code',
    tagline: 'Already have a code? Verify it.',
    description:
      'Look up what a code covers, what it is commonly confused with, and whether it matches what you documented.',
    status: 'AVAILABLE',
    icon: 'check',
  },
  {
    key: 'DOCUMENTATION_CHECK',
    href: '/documentation-check',
    name: 'Documentation Check',
    tagline: 'Check your note for coding specificity.',
    description:
      'Paste a clinical note. We show which coding-relevant details are present and which are missing.',
    status: 'AVAILABLE',
    icon: 'document',
  },
  {
    key: 'CLAIM_SCRUBBER',
    href: '/claim-scrubber',
    name: 'Claim Scrubber',
    tagline: 'Catch problems before the claim goes out.',
    description:
      'Review a set of codes and their supporting documentation together, and flag inconsistencies before submission.',
    status: 'PLANNED',
    icon: 'shield',
  },
]

export const AVAILABLE_TOOLS = TOOLS.filter((t) => t.status === 'AVAILABLE')

export function toolByKey(key: Tool): ToolDefinition | undefined {
  return TOOLS.find((t) => t.key === key)
}

export function toolName(key: Tool): string {
  return toolByKey(key)?.name ?? key
}
