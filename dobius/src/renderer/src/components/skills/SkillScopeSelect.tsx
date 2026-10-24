import React from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { SkillScope } from './skill-files'

/** Picks the folder a new skill is written into. */
export function SkillScopeSelect({
  scopes,
  value,
  onChange
}: {
  scopes: readonly SkillScope[]
  value: string | null
  onChange: (scopeId: string) => void
}): React.JSX.Element {
  return (
    <label className="flex min-w-0 items-center gap-2 text-[12px] text-[var(--board-text-muted)]">
      <span className="shrink-0">{translate('skills.scope.label', 'Save to')}</span>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger
          className="h-8 min-w-0 max-w-[340px] text-[12px]"
          aria-label={translate('skills.scope.label', 'Save to')}
        >
          <SelectValue placeholder={translate('skills.scope.placeholder', 'Choose a folder')} />
        </SelectTrigger>
        <SelectContent>
          {scopes.map((scope) => (
            <SelectItem key={scope.id} value={scope.id} title={scope.path}>
              {scope.label} <span className="font-mono text-[11px] opacity-60">{scope.path}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
