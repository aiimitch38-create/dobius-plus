import { Image } from 'react-native'

type Props = {
  size?: number
}

export function DobiusLogo({ size = 24 }: Props) {
  return (
    <Image
      source={require('../../assets/icon.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel="Dobius+"
    />
  )
}
