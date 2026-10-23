import React, { useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { AgentIcon } from '@/lib/agent-catalog'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../../shared/types'
import type { BoardAgentOption } from './BoardAgentPicker'
import {
  TEAM_MAX_SLOTS,
  TEAM_NAME_MAX_CHARS,
  TEAM_ROLES,
  TEAM_ROLE_AGENTS_STORAGE_KEY,
  fillAllSlots,
  initialTeam,
  parseRoleAgentMap,
  rememberRoleAgents,
  removeSlot,
  resizeTeam,
  setSlotAgent,
  setSlotRole,
  teamGroupName,
  type RoleAgentMap,
  type TeamRole,
  type TeamSlot
} from './team-composer'

function roleLabel(role: TeamRole): string {
  switch (role) {
    case 'general':
      return translate('board.team.role.general', 'General')
    case 'frontend':
      return translate('board.team.role.frontend', 'Frontend')
    case 'backend':
      return translate('board.team.role.backend', 'Backend')
    case 'tests':
      return translate('board.team.role.tests', 'Testers')
    case 'review':
      return translate('board.team.role.review', 'Reviewers')
    case 'design':
      return translate('board.team.role.design', 'Design')
    case 'docs':
      return translate('board.team.role.docs', 'Docs')
    case 'security':
      return translate('board.team.role.security', 'Security')
  }
}

// Why: the role map is a per-device convenience; an unreadable store just means built-in defaults.
function loadSavedMap(): RoleAgentMap {
  try {
    return parseRoleAgentMap(window.localStorage.getItem(TEAM_ROLE_AGENTS_STORAGE_KEY), isTuiAgent)
  } catch {
    return {}
  }
}

function saveMap(map: RoleAgentMap): void {
  try {
    window.localStorage.setItem(TEAM_ROLE_AGENTS_STORAGE_KEY, JSON.stringify(map))
  } catch (error) {
    console.warn('[board-team] could not save role defaults', error)
  }
}

/** Name the team, pick a role and an agent per slot (up to 12), then spawn them all as one group. */
export function BoardTeamComposer({
  count,
  agents,
  onSpawn,
  onClose
}: {
  count: number
  agents: readonly BoardAgentOption[]
  /** `name` is the typed team name (trimmed), or null for the default group name. */
  onSpawn: (slots: TeamSlot[], name: string | null) => void
  onClose: () => void
}): React.JSX.Element {
  const available = agents.map((a) => a.id)
  const [saved] = useState(loadSavedMap)
  const [slots, setSlots] = useState<TeamSlot[]>(() => initialTeam(count, available, saved))
  const [remember, setRemember] = useState(false)
  const [teamName, setTeamName] = useState('')
  const resize = (n: number): void => setSlots((s) => resizeTeam(s, n, available, saved))

  const spawn = (): void => {
    if (remember) {
      saveMap(rememberRoleAgents(saved, slots))
    }
    onSpawn(slots, teamGroupName(teamName))
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent data-surface="board" className="flex max-h-[80vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{translate('board.team.title', 'Compose a team')}</DialogTitle>
        </DialogHeader>
        <Input
          value={teamName}
          maxLength={TEAM_NAME_MAX_CHARS}
          placeholder={translate('board.team.namePlaceholder', 'Team name (optional)')}
          aria-label={translate('board.team.nameLabel', 'Team name')}
          onChange={(event) => setTeamName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && slots.length > 0) {
              event.preventDefault()
              spawn()
            }
          }}
        />
        {slots.length === 0 ? (
          <p className="text-[13px] text-[var(--board-text-muted)]">
            {translate('board.agentPicker.none', 'No agents are enabled in Settings')}
          </p>
        ) : (
          <div className="scrollbar-sleek min-h-0 flex-1 space-y-1.5 overflow-auto">
            {slots.map((slot, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-[12px] text-[var(--board-text-muted)]">
                  {index + 1}
                </span>
                <Select
                  value={slot.role}
                  onValueChange={(v) =>
                    setSlots((s) => setSlotRole(s, index, v as TeamRole, available, saved))
                  }
                >
                  <SelectTrigger
                    size="sm"
                    className="flex-1"
                    aria-label={translate('board.team.roleLabel', 'Role')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEAM_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {roleLabel(role)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={slot.agent}
                  onValueChange={(v) => setSlots((s) => setSlotAgent(s, index, v as TuiAgent))}
                >
                  <SelectTrigger
                    size="sm"
                    className="flex-1"
                    aria-label={translate('board.team.agentLabel', 'Agent')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        <AgentIcon agent={agent.id} size={13} />
                        {agent.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={slots.length <= 1}
                  aria-label={translate('board.team.removeSlot', 'Remove slot {{n}}', {
                    n: index + 1
                  })}
                  onClick={() => setSlots((s) => removeSlot(s, index))}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
        {slots.length > 0 && agents.length > 1 ? (
          <div
            role="group"
            aria-label={translate('board.team.fillAll', 'Fill all')}
            className="flex flex-wrap items-center gap-1"
          >
            <span className="mr-1 text-[12px] text-[var(--board-text-muted)]">
              {translate('board.team.fillAll', 'Fill all')}
            </span>
            {agents.map((agent) => (
              <Button
                key={agent.id}
                type="button"
                variant="ghost"
                size="icon-sm"
                title={agent.label}
                aria-label={translate('board.team.fillAllWith', 'Set every slot to {{agent}}', {
                  agent: agent.label
                })}
                aria-pressed={slots.every((slot) => slot.agent === agent.id)}
                className="aria-pressed:bg-[var(--board-accent-tint)]"
                onClick={() => setSlots((s) => fillAllSlots(s, agent.id))}
              >
                <AgentIcon agent={agent.id} size={15} />
              </Button>
            ))}
          </div>
        ) : null}
        <label className="flex items-center gap-2 self-start text-[12px] text-[var(--board-text-muted)]">
          <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
          {translate('board.team.remember', 'Remember agents as role defaults')}
        </label>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label={translate('board.team.countLabel', 'Team size')}
            className="flex items-center gap-1"
          >
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={slots.length <= 1}
              aria-label={translate('board.team.fewer', 'One fewer console')}
              onClick={() => resize(slots.length - 1)}
            >
              <Minus className="size-3.5" />
            </Button>
            <span
              aria-live="polite"
              className="w-7 text-center text-[13px] font-medium text-[var(--board-text)] tabular-nums"
            >
              {slots.length}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={slots.length === 0 || slots.length >= TEAM_MAX_SLOTS}
              aria-label={translate('board.team.more', 'One more console (up to {{max}})', {
                max: TEAM_MAX_SLOTS
              })}
              onClick={() => resize(slots.length + 1)}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          <div className="flex-1" />
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {translate('board.common.cancel', 'Cancel')}
          </Button>
          <Button type="button" size="sm" disabled={slots.length === 0} onClick={spawn}>
            {translate('board.team.spawn', 'Spawn {{count}} and group', { count: slots.length })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
