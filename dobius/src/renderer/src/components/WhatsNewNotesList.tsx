import type React from 'react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { WhatsNewSection } from '../../../shared/whats-new'

/** The plain-English notes, one short list per version, newest first. */
export function WhatsNewNotesList({
  sections,
  showVersions,
  versionClassName
}: {
  sections: readonly WhatsNewSection[]
  /** Label each list with its version (used when several versions are shown). */
  showVersions: boolean
  versionClassName?: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {sections.map((section) => (
        <section key={section.version} data-whats-new-version={section.version}>
          {showVersions ? (
            <h3
              className={cn(
                'mb-1.5 text-[11px] leading-[14px] font-semibold text-muted-foreground',
                versionClassName
              )}
            >
              {translate('whatsNew.versionHeading', 'Version {{version}}', {
                version: section.version
              })}
            </h3>
          ) : null}
          <ul className="list-disc space-y-1.5 pl-[18px] text-[13px] leading-[18px]">
            {section.bullets.map((bullet, index) => (
              <li key={`${index}:${bullet}`}>{bullet}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
