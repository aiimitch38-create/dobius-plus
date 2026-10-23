import * as ts from 'typescript'
import type { Plugin } from 'vite'

const SANDBOX_MODULES = new Set([
  'electron',
  'events',
  'timers',
  'url',
  'node:events',
  'node:timers',
  'node:url'
])
const MAX_PRELOAD_BYTES = 16 * 1024 * 1024

/** Sandboxed preload require is a restricted polyfill, not Node module resolution. */
export function assertSandboxPreloadBundle(code: string, fileName = 'index.js'): void {
  if (Buffer.byteLength(code, 'utf8') > MAX_PRELOAD_BYTES) {
    throw new Error('Sandbox preload exceeds its bounded inspection size.')
  }
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const inspect = (node: ts.Node): void => {
    if (
      (ts.isPropertyAccessExpression(node) && ['require', '__require'].includes(node.name.text)) ||
      (ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        ['require', '__require'].includes(node.argumentExpression.text))
    ) {
      throw new Error('Sandbox preload cannot use member-based module loading.')
    }
    if (ts.isIdentifier(node) && ['require', '__require'].includes(node.text)) {
      const parent = node.parent
      const directCall = ts.isCallExpression(parent) && parent.expression === node
      const featureProbe = ts.isTypeOfExpression(parent)
      if (!directCall && !featureProbe) {
        throw new Error('Sandbox preload cannot alias or pass its module loader.')
      }
    }
    if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
      throw new Error('Sandbox preload must be one CommonJS bundle without ES module imports.')
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        throw new Error('Sandbox preload cannot load dynamic module chunks.')
      }
      if (
        ts.isIdentifier(node.expression) &&
        ['require', '__require'].includes(node.expression.text)
      ) {
        const argument = node.arguments[0]
        if (node.arguments.length !== 1 || !argument || !ts.isStringLiteralLike(argument)) {
          throw new Error('Sandbox preload has an unsupported dynamic require.')
        }
        if (!SANDBOX_MODULES.has(argument.text)) {
          throw new Error(`Sandbox preload requires unsupported external module: ${argument.text}`)
        }
      }
    }
    ts.forEachChild(node, inspect)
  }
  inspect(source)
}

export function sandboxPreloadBundlePlugin(): Plugin {
  return {
    name: 'dobius-sandbox-preload-bundle',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') {
          assertSandboxPreloadBundle(item.code, item.fileName)
        }
      }
    }
  }
}
