import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getHostingerPaneSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.hostinger.search.title', 'Hostinger'),
    description: translate(
      'auto.components.settings.hostinger.search.description',
      'Connect a Hostinger API token to see your VPS, domains, and DNS records, and add DNS records.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.hostinger.search.keywordHostinger', 'hostinger'),
      ...translateSearchKeyword('auto.components.settings.hostinger.search.keywordVps', 'vps'),
      ...translateSearchKeyword('auto.components.settings.hostinger.search.keywordDomain', 'domain'),
      ...translateSearchKeyword('auto.components.settings.hostinger.search.keywordDns', 'dns'),
      ...translateSearchKeyword('auto.components.settings.hostinger.search.keywordToken', 'token'),
      ...translateSearchKeyword('auto.components.settings.hostinger.search.keywordHosting', 'hosting')
    ]
  }
])
