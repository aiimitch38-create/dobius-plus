import React from 'react'
import { AgentIcon } from '@/lib/agent-catalog'
import { AgentLetterIcon } from '@/lib/agent-icon-glyphs'
import { USAGE_PROVIDER_LABELS, usageProviderAgent, type UsageProviderId } from './board-usage-model'

/** A rate-limit provider's mark: the agent catalog icon, or a letter tile when it has none. */
export function ProviderLogo({
  provider,
  size = 16
}: {
  provider: UsageProviderId
  size?: number
}): React.JSX.Element {
  const agent = usageProviderAgent(provider)
  if (agent) {
    return <AgentIcon agent={agent} size={size} />
  }
  return <AgentLetterIcon letter={USAGE_PROVIDER_LABELS[provider].charAt(0)} size={size} />
}
