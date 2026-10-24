import { translate } from '@/i18n/i18n'

/** "3 consoles · 1 group": each count pluralized on its own. */
export function presetMetaLine(consoles: number, groups: number): string {
  const consolePart =
    consoles === 1
      ? translate('board.presets.metaConsoles_one', '1 console')
      : translate('board.presets.metaConsoles_other', '{{n}} consoles', { n: consoles })
  const groupPart =
    groups === 1
      ? translate('board.presets.metaGroups_one', '1 group')
      : translate('board.presets.metaGroups_other', '{{n}} groups', { n: groups })
  return `${consolePart} · ${groupPart}`
}
