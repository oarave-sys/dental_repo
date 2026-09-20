'use server'

import { revalidatePath } from 'next/cache'
import { requireActor } from '@/lib/auth/current'
import { requirePermission } from '@/lib/authz'
import { deleteSavedCase } from '@/lib/coding/queries'
import { isAppError } from '@/lib/errors'

export interface CaseActionState {
  error?: string
}

export async function deleteCaseAction(
  _prev: CaseActionState,
  formData: FormData,
): Promise<CaseActionState> {
  const actor = await requireActor()
  requirePermission(actor, 'case:delete')

  try {
    await deleteSavedCase({
      organizationId: actor.organizationId,
      userId: actor.userId,
      caseId: String(formData.get('caseId') ?? ''),
    })
    revalidatePath('/cases')
    revalidatePath('/dashboard')
    return {}
  } catch (error) {
    return { error: isAppError(error) ? error.message : 'We could not delete that case.' }
  }
}
