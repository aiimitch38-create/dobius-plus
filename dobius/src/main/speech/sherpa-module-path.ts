import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

// Why: the main sherpa-onnx npm package uses WASM, which cannot access the
// host filesystem to load model files. The platform-specific native addon
// (e.g. sherpa-onnx-darwin-arm64) has direct filesystem access and better
// performance. Both the STT worker and local TTS load it by absolute path
// because out/main/ code can't resolve the bare package name at runtime.
export function getSherpaModulePath(): string {
  const nativePkg =
    process.platform === 'win32' && process.arch === 'x64'
      ? 'sherpa-onnx-win-x64'
      : `sherpa-onnx-${process.platform}-${process.arch}`

  if (app.isPackaged) {
    const resourcesNodeModule = join(process.resourcesPath, 'node_modules', nativePkg)
    if (existsSync(resourcesNodeModule)) {
      return resourcesNodeModule
    }
    return join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', nativePkg)
  }

  const resolved = require.resolve(nativePkg)
  return join(resolved, '..')
}
