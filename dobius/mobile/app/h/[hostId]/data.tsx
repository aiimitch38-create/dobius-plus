import { useLocalSearchParams } from 'expo-router'
import { MobileDataCatalogPanel } from '../../../src/files/MobileDataCatalogPanel'

export default function MobileDataCatalogRoute() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>()
  return <MobileDataCatalogPanel hostId={hostId} />
}
