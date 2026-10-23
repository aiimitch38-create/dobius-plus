import { CloudId, CloudJobInput, type CloudJob } from '../../shared/cloud-jobs'
import type { CloudJobPrincipal, CloudJobServiceOptions } from './cloud-job-service'
import type { CloudJobStore } from './cloud-jobs/store'
import type { CloudJobAdamSubmissionClient } from './cloud-jobs/cloud-job-adam-client'

type Admission = {
  readStore: () => CloudJobStore
  canUseWorkspace: CloudJobServiceOptions['canUseWorkspace']
  adamClient?: CloudJobAdamSubmissionClient
}

/** Parent identifiers never enter the public job DTO; only a consumed capability binds them. */
export async function admitCloudJobSubmission(
  authority: Admission,
  principal: CloudJobPrincipal,
  raw: CloudJobInput,
  grant?: unknown,
  verifiedAdam?: { assertCurrent: () => void }
): Promise<CloudJob> {
  CloudId.parse(principal.id)
  const input = CloudJobInput.parse(raw)
  input.dependencies = [...new Set(input.dependencies)].sort()
  const store = authority.readStore()
  const project = store.project(input.projectId)
  const assertCurrent = () => {
    if (
      authority.readStore() !== store ||
      JSON.stringify(store.project(project.id)) !== JSON.stringify(project)
    ) {
      throw new Error('Project changed during authorization; retry with current authority.')
    }
    verifiedAdam?.assertCurrent()
  }
  if (
    principal.kind !== 'local' &&
    !(await authority.canUseWorkspace(principal, input.workspaceId, project))
  ) {
    throw new Error('Cloud job access denied.')
  }
  assertCurrent()
  if (grant === undefined) {
    return store.submit(input, principal.id)
  }
  if (!authority.adamClient) {
    throw new Error('Authenticated ADAM parent binding is unavailable.')
  }
  const consumed =
    verifiedAdam && authority.adamClient.consumeBindingForRecovery
      ? await authority.adamClient.consumeBindingForRecovery(grant, input)
      : await authority.adamClient.consumeBinding(grant, input)
  if (consumed.state !== 'accepted') {
    throw new Error('Authenticated ADAM parent binding is unavailable.')
  }
  assertCurrent()
  if (verifiedAdam) {
    const recovered = store.findAdamBoundChild(input, consumed.value, principal.id)
    if (recovered) {
      return recovered
    }
    if (consumed.value.binding.expiresAtMs <= store.currentTimeMs()) {
      throw new Error('Expired ADAM intent has no previously committed child.')
    }
    assertCurrent()
  }
  // No await may split this final authority check from the atomic job/binding/receipt write.
  return store.submitAdamBound(input, principal.id, consumed.value)
}
