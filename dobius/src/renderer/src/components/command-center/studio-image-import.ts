export async function readStudioImage(file: File): Promise<string> {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 8 * 1024 * 1024
  ) {
    throw new Error('Choose a PNG, JPEG, or WebP smaller than 8 MB.')
  }
  const bitmap = await createImageBitmap(file)
  const pixels = bitmap.width * bitmap.height
  bitmap.close()
  if (pixels > 24000000) {
    throw new Error('Choose an image smaller than 24 megapixels.')
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The image could not be imported. Try another file.'))
    reader.readAsDataURL(file)
  })
}
