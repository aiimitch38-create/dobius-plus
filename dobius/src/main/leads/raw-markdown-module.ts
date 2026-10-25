// Why: the main tsconfig types only `electron-vite/node`, which does not pull in
// `vite/client`, so Vite's `?raw` text imports need an ambient declaration. It
// lives in a .ts script (no imports/exports) because `src/**/*.d.ts` is
// gitignored.
declare module '*.md?raw' {
  const text: string
  export default text
}
