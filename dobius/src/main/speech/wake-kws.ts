import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { downloadFileOverHttps, extractTarBz2 } from './local-tts'

/**
 * The English zipformer KWS model. Filename ENUMERATED from the release
 * assets via `gh api repos/k2-fsa/sherpa-onnx/releases/tags/kws-models`
 * on 2026-08-30 (gigaspeech = English; wenetspeech = Chinese) — not guessed.
 */
export const KWS_MODEL_DIR_NAME = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01'
export const KWS_MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/${KWS_MODEL_DIR_NAME}.tar.bz2`

export const WAKE_KEYWORD = 'adam'
const KEYWORDS_FILENAME = 'dobius-wake-keywords.txt'

export type KwsAssets = {
  modelDir: string
  files: string[]
  keywordsFilePath: string
}

/**
 * Greedy longest-match of `word` against the model's BPE piece inventory.
 * Sentencepiece marks a word start with '▁'; gigaspeech pieces are uppercase.
 * Returns the space-joined pieces, or null when some span has no piece —
 * callers treat null as "keyword spotting off", never an error.
 */
export function encodeKeywordTokens(word: string, tokens: string[]): string | null {
  const inventory = new Set(tokens)
  const target = `▁${word.toUpperCase()}`
  const pieces: string[] = []
  let position = 0
  while (position < target.length) {
    let matched: string | null = null
    for (let end = target.length; end > position; end -= 1) {
      const candidate = target.slice(position, end)
      if (inventory.has(candidate)) {
        matched = candidate
        break
      }
    }
    if (!matched) {
      return null
    }
    pieces.push(matched)
    position += matched.length
  }
  return pieces.join(' ')
}

/** One keywords-file line: encoded pieces plus the '@' display form. */
export function buildKeywordsLine(word: string, tokens: string[]): string | null {
  const encoded = encodeKeywordTokens(word, tokens)
  return encoded ? `${encoded} @${word}` : null
}

/**
 * Inspects the extracted archive (never assumes filenames) and writes the
 * wake-keyword file beside the model. Null when the dir is absent or the
 * keyword cannot be encoded with this model's pieces.
 */
export function resolveKwsAssets(modelsRoot: string, keyword = WAKE_KEYWORD): KwsAssets | null {
  const modelDir = join(modelsRoot, KWS_MODEL_DIR_NAME)
  if (!existsSync(modelDir)) {
    return null
  }
  const files = readdirSync(modelDir).filter((f) => f.endsWith('.onnx') || f === 'tokens.txt')
  const tokensFile = files.find((f) => f === 'tokens.txt')
  const hasTransducer = ['encoder', 'decoder', 'joiner'].every((role) =>
    files.some((f) => f.includes(role) && f.endsWith('.onnx'))
  )
  if (!tokensFile || !hasTransducer) {
    return null
  }
  const keywordsFilePath = join(modelDir, KEYWORDS_FILENAME)
  if (!existsSync(keywordsFilePath)) {
    // tokens.txt lines are '<piece> <id>'; only the piece matters here.
    const tokens = readFileSync(join(modelDir, tokensFile), 'utf8')
      .split('\n')
      .map((line) => line.split(' ')[0])
      .filter((piece) => piece.length > 0)
    const line = buildKeywordsLine(keyword, tokens)
    if (!line) {
      return null
    }
    writeFileSync(keywordsFilePath, `${line}\n`)
  }
  return { modelDir, files, keywordsFilePath }
}

let kwsDownload: Promise<void> | null = null

/** Fire-and-forget friendly; ~15 MB; the tarball never survives extraction. */
export function ensureKwsModel(
  modelsRoot: string,
  download: (url: string, dest: string) => Promise<void> = downloadFileOverHttps,
  extract: (archivePath: string, destDir: string) => Promise<void> = extractTarBz2
): Promise<void> {
  const modelDir = join(modelsRoot, KWS_MODEL_DIR_NAME)
  if (existsSync(modelDir) && readdirSync(modelDir).length > 0) {
    return Promise.resolve()
  }
  kwsDownload ??= (async () => {
    const archivePath = join(modelsRoot, `${KWS_MODEL_DIR_NAME}.tar.bz2`)
    try {
      await download(KWS_MODEL_URL, archivePath)
      await extract(archivePath, modelDir)
    } catch (error) {
      rmSync(modelDir, { recursive: true, force: true })
      throw error
    } finally {
      rmSync(archivePath, { force: true })
      kwsDownload = null
    }
  })()
  return kwsDownload
}
