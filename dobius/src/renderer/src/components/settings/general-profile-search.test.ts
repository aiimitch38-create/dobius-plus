import { describe, expect, it } from 'vitest'
import { getGeneralPaneSearchEntries, getGeneralProfileSearchEntries } from './general-search'
import { matchesSettingsSearch } from './settings-search'

describe('"Your name" setting search', () => {
  it('is found by searching "name"', () => {
    expect(matchesSettingsSearch('name', getGeneralProfileSearchEntries())).toBe(true)
    expect(matchesSettingsSearch('greeting', getGeneralProfileSearchEntries())).toBe(true)
  })

  it('is part of the General pane search entries', () => {
    expect(getGeneralPaneSearchEntries().some((e) => e.title === 'Your name')).toBe(true)
  })
})
