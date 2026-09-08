import type { CustomAgent } from '../../shared/agents'
import { readAgentPromptFiles } from './agent-identity-files'

// Why 8 and not 40: measured 2026-09-07, the last 40 entries were 5.4-5.9KB for
// every crew member — 26% of Gunner's system prompt, 69% of Adam's and 78% of
// Voice Conductor's. Two costs, not one. It is the largest single section of the
// prompt for most agents, and because each entry is 120 characters of the agent's
// own past prose it is also the strongest style example in the context, sitting
// last and closest to the reply. Agents were reading forty samples of themselves
// writing at length and then continuing the pattern. Eight is enough to answer
// "what did I just do" without teaching the voice.
const PROGRESS_LOG_LINES = 8

function progressLogRecentLines(content: string): string {
  return content.split(/\r?\n/).filter(Boolean).slice(-PROGRESS_LOG_LINES).join('\n')
}

function addPromptSection(sections: string[], heading: string, content: string): void {
  const text = content.trim()
  if (text) {
    sections.push(`## ${heading}\n\n${text}`)
  }
}

export function buildSystemPrompt(agent: CustomAgent): string {
  const files = readAgentPromptFiles(agent.id)
  const sections: string[] = []
  // Why: old agents may still carry their instructions only in systemPrompt.
  addPromptSection(sections, 'Instructions', agent.systemPrompt)
  addPromptSection(sections, 'Soul', files.soul)
  addPromptSection(sections, 'Role', files.role)
  addPromptSection(sections, 'Playbook', files.playbook)
  addPromptSection(sections, 'Briefing directive', files.brief)
  addPromptSection(sections, 'Rules', files.rules)
  addPromptSection(sections, 'About the user', files.crewUser)
  addPromptSection(sections, 'House tool conventions', files.crewTools)
  addPromptSection(sections, 'Memory', files.memory)
  addPromptSection(sections, 'Progress log (recent)', progressLogRecentLines(files.progressLog))
  return sections.join('\n\n')
}
