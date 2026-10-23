import { z } from 'zod'
import { CloudJobInput } from './cloud-jobs'
import { CloudJobAdamBindingGrant } from './cloud-job-adam-receipts'

/** Stdin/local-socket envelope only; this is not a renderer or paired-device API. */
export const CloudJobAdamSubmission = z
  .object({
    schemaVersion: z.literal(1),
    input: CloudJobInput,
    grant: CloudJobAdamBindingGrant
  })
  .strict()

export type CloudJobAdamSubmission = z.infer<typeof CloudJobAdamSubmission>
