import { Bot } from 'lucide-react'
import type { Person } from './kanban-types'

export function AvatarStack({
  people,
  limit = 3
}: {
  people: Person[]
  limit?: number
}): React.JSX.Element {
  return (
    <div className="flex -space-x-2" aria-label={people.map((person) => person.name).join(', ')}>
      {people.slice(0, limit).map((person, index) => (
        <span
          key={person.id}
          className="grid size-7 place-items-center overflow-hidden rounded-full border-2 border-kanban-card bg-kanban-avatar text-[9px] font-bold text-kanban-avatar-foreground"
          style={{ zIndex: index + 1 }}
          title={person.name}
        >
          {person.avatarUrl ? (
            <img src={person.avatarUrl} alt="" className="size-full object-cover" />
          ) : person.kind === 'agent' ? (
            <Bot className="size-3.5" />
          ) : (
            person.initials
          )}
        </span>
      ))}
    </div>
  )
}
