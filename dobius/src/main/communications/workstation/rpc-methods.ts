// Registers every workstation-git / media-service command as a runtime RPC
// method. NOT yet wired into src/main/runtime/rpc/methods/index.ts's
// ALL_RPC_METHODS (a file several sibling agents touch concurrently) — see
// this feature's report for the exact paste-ready registration line. Kept
// here, in this feature's own owned directory, so registration is a single
// import + spread away rather than scattered per-command edits elsewhere.
import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../../runtime/rpc/core'
import { OptionalString, requiredString } from '../../runtime/rpc/schemas'
import { getGitIdentity, discoverGitBashPrerequisite } from './identity'
import { checkPipelineHotstart } from './pipeline-hotstart'
import { fetchWorkspaceIcon } from './workspace-icon'
import {
  cloneProjectRepository,
  getProjectLocalRepoDiff,
  getProjectLocalRepoSnapshot,
  getProjectRepoSyncStatus,
  listProjectLocalRepositories,
  pullProjectLocalRepository,
  pushProjectLocalRepository
} from './local-repos'
import { createProjectRemoteBranch, deleteProjectRemoteBranch, getProjectRepoDiff, getProjectRepoSnapshot } from './remote-repos'
import { openProjectMergeRecoveryTerminal, openProjectTerminal } from './merge-recovery'
import {
  mergeProjectPullRequest,
  publishProjectPullRequestMergedStatus,
  signProjectPullRequestReviewRequest,
  signProjectPullRequestStatus
} from './pull-requests'
import {
  fetchMediaBytes,
  getMediaProxyPort,
  pickAndUploadImage,
  pickAndUploadMedia,
  uploadMedia,
  uploadMediaBytes
} from './media/media-commands'

const ReposDirParams = z.object({ reposDir: OptionalString.nullable() })

const ProjectRepoRef = z.object({
  reposDir: OptionalString.nullable(),
  projectDtag: requiredString('Missing project identifier'),
  cloneUrl: OptionalString.nullable(),
  defaultBranch: OptionalString.nullable()
})

const LocalSnapshotParams = ProjectRepoRef.extend({ baseBranch: OptionalString.nullable() })
const LocalDiffParams = ProjectRepoRef.extend({
  baseBranch: OptionalString.nullable(),
  baseCommit: OptionalString.nullable(),
  targetCommit: OptionalString.nullable()
})

const RemoteRefParams = z.object({
  cloneUrl: requiredString('Missing clone URL'),
  defaultBranch: OptionalString.nullable(),
  baseBranch: OptionalString.nullable(),
  targetRef: OptionalString.nullable(),
  targetCommit: OptionalString.nullable()
})

const SyncStatusParams = z.object({
  reposDir: OptionalString.nullable(),
  projectDtag: requiredString('Missing project identifier'),
  cloneUrl: requiredString('Missing clone URL'),
  branchName: OptionalString.nullable(),
  baseBranch: OptionalString.nullable()
})

const PushParams = SyncStatusParams
const PullParams = z.object({
  reposDir: OptionalString.nullable(),
  projectDtag: requiredString('Missing project identifier'),
  cloneUrl: requiredString('Missing clone URL'),
  branchName: OptionalString.nullable()
})

const RemoteBranchCreateParams = z.object({
  cloneUrl: requiredString('Missing clone URL'),
  sourceBranch: requiredString('Missing source branch'),
  expectedCommit: requiredString('Missing expected commit'),
  newBranch: requiredString('Missing new branch name')
})

const RemoteBranchDeleteParams = z.object({
  cloneUrl: requiredString('Missing clone URL'),
  branch: requiredString('Missing branch'),
  expectedCommit: requiredString('Missing expected commit')
})

const OpenTerminalParams = ProjectRepoRef
const OpenMergeRecoveryParams = z.object({
  reposDir: OptionalString.nullable(),
  projectDtag: requiredString('Missing project identifier'),
  targetCloneUrl: requiredString('Missing target clone URL'),
  sourceCloneUrl: requiredString('Missing source clone URL'),
  targetBranch: requiredString('Missing target branch'),
  sourceBranch: requiredString('Missing source branch'),
  expectedCommit: requiredString('Missing expected commit')
})

const MergePullRequestParams = z.object({
  targetCloneUrl: requiredString('Missing target clone URL'),
  sourceCloneUrl: requiredString('Missing source clone URL'),
  targetOwner: requiredString('Missing target owner'),
  repoAddress: requiredString('Missing repo address'),
  pullRequestId: requiredString('Missing pull request id'),
  pullRequestAuthor: requiredString('Missing pull request author'),
  statusCreatedAt: z.number(),
  targetBranch: requiredString('Missing target branch'),
  sourceBranch: requiredString('Missing source branch'),
  expectedCommit: requiredString('Missing expected commit')
})

const SignStatusParams = z.object({
  targetOwner: requiredString('Missing target owner'),
  repoAddress: requiredString('Missing repo address'),
  pullRequestId: requiredString('Missing pull request id'),
  pullRequestAuthor: requiredString('Missing pull request author'),
  status: z.enum(['open', 'draft', 'closed']),
  createdAt: z.number()
})

const SignReviewRequestParams = z.object({
  targetOwner: requiredString('Missing target owner'),
  repoAddress: requiredString('Missing repo address'),
  pullRequestId: requiredString('Missing pull request id'),
  reviewers: z.array(z.string()),
  reviewerLabel: requiredString('Missing reviewer label')
})

const PublishMergedStatusParams = z.object({
  targetOwner: requiredString('Missing target owner'),
  statusEvent: requiredString('Missing status event')
})

const RelayUrlParams = z.object({ relayUrl: requiredString('Missing relay URL') })

const UploadMediaParams = z.object({ filePath: requiredString('Missing file path'), isTemp: z.boolean() })
const UploadMediaBytesParams = z.object({
  data: z.array(z.number()),
  filename: OptionalString,
  progressId: OptionalString
})
const FetchMediaBytesParams = z.object({ url: requiredString('Missing media URL') })

export const WORKSTATION_METHODS: RpcMethod[] = [
  defineMethod({ name: 'workstationGit.getIdentity', params: null, handler: () => getGitIdentity() }),
  defineMethod({
    name: 'workstationGit.discoverGitBashPrerequisite',
    params: null,
    handler: () => discoverGitBashPrerequisite()
  }),
  defineMethod({
    name: 'workstationGit.checkPipelineHotstart',
    params: null,
    handler: (_params, { runtime }) => checkPipelineHotstart(runtime)
  }),
  defineMethod({
    name: 'workstationGit.fetchWorkspaceIcon',
    params: RelayUrlParams,
    handler: (params) => fetchWorkspaceIcon(params.relayUrl)
  }),
  defineMethod({
    name: 'workstationGit.listLocalRepositories',
    params: ReposDirParams,
    handler: (params) => listProjectLocalRepositories(params)
  }),
  defineMethod({
    name: 'workstationGit.cloneRepository',
    params: ProjectRepoRef.extend({ cloneUrl: requiredString('Missing clone URL') }),
    handler: (params) => cloneProjectRepository(params)
  }),
  defineMethod({
    name: 'workstationGit.getLocalSnapshot',
    params: LocalSnapshotParams,
    handler: (params) => getProjectLocalRepoSnapshot(params)
  }),
  defineMethod({
    name: 'workstationGit.getLocalDiff',
    params: LocalDiffParams,
    handler: (params) => getProjectLocalRepoDiff(params)
  }),
  defineMethod({
    name: 'workstationGit.getRemoteSnapshot',
    params: RemoteRefParams,
    handler: (params) => getProjectRepoSnapshot(params)
  }),
  defineMethod({
    name: 'workstationGit.getRemoteDiff',
    params: RemoteRefParams,
    handler: (params) => getProjectRepoDiff(params)
  }),
  defineMethod({
    name: 'workstationGit.getSyncStatus',
    params: SyncStatusParams,
    handler: (params) => getProjectRepoSyncStatus(params)
  }),
  defineMethod({ name: 'workstationGit.push', params: PushParams, handler: (params) => pushProjectLocalRepository(params) }),
  defineMethod({ name: 'workstationGit.pull', params: PullParams, handler: (params) => pullProjectLocalRepository(params) }),
  defineMethod({
    name: 'workstationGit.createRemoteBranch',
    params: RemoteBranchCreateParams,
    handler: (params) => createProjectRemoteBranch(params)
  }),
  defineMethod({
    name: 'workstationGit.deleteRemoteBranch',
    params: RemoteBranchDeleteParams,
    handler: (params) => deleteProjectRemoteBranch(params)
  }),
  defineMethod({
    name: 'workstationGit.openTerminal',
    params: OpenTerminalParams,
    handler: (params) => openProjectTerminal(params)
  }),
  defineMethod({
    name: 'workstationGit.openMergeRecoveryTerminal',
    params: OpenMergeRecoveryParams,
    handler: (params) => openProjectMergeRecoveryTerminal(params)
  }),
  defineMethod({
    name: 'workstationGit.mergePullRequest',
    params: MergePullRequestParams,
    handler: (params) => mergeProjectPullRequest(params)
  }),
  defineMethod({
    name: 'workstationGit.signPullRequestReviewRequest',
    params: SignReviewRequestParams,
    handler: async (params) => {
      await signProjectPullRequestReviewRequest(params)
      return null
    }
  }),
  defineMethod({
    name: 'workstationGit.signPullRequestStatus',
    params: SignStatusParams,
    handler: async (params) => {
      await signProjectPullRequestStatus(params)
      return null
    }
  }),
  defineMethod({
    name: 'workstationGit.publishPullRequestMergedStatus',
    params: PublishMergedStatusParams,
    handler: async (params) => {
      await publishProjectPullRequestMergedStatus(params)
      return null
    }
  }),
  defineMethod({ name: 'media.pickAndUploadImage', params: null, handler: () => pickAndUploadImage() }),
  defineMethod({ name: 'media.pickAndUploadMedia', params: null, handler: () => pickAndUploadMedia() }),
  defineMethod({
    name: 'media.upload',
    params: UploadMediaParams,
    handler: (params) => uploadMedia(params.filePath, params.isTemp)
  }),
  defineMethod({
    name: 'media.uploadBytes',
    params: UploadMediaBytesParams,
    handler: (params) => uploadMediaBytes(params.data, params.filename)
  }),
  defineMethod({
    name: 'media.fetchBytes',
    params: FetchMediaBytesParams,
    handler: (params) => fetchMediaBytes(params.url)
  }),
  defineMethod({ name: 'media.getProxyPort', params: null, handler: () => getMediaProxyPort() })
]
