const path = require('node:path')
const { realpathSync } = require('node:fs')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const sharedRoot = path.resolve(projectRoot, '..', 'src', 'shared')

const config = getDefaultConfig(projectRoot)

// Why: mobile source-control prompts use the same pure builders as desktop.
// Metro only watches mobile/ by default, so make repo-root shared modules visible.
const dependencyPath = path.join(projectRoot, 'node_modules')
const dependencyRoot = realpathSync(dependencyPath)
// Node can follow a relocated dependency cache, but Metro also needs its real tree in the watch map.
const relocatedDependencies = dependencyRoot === dependencyPath ? [] : [dependencyRoot]
config.watchFolders = Array.from(
  new Set([...(config.watchFolders ?? []), sharedRoot, ...relocatedDependencies])
)

module.exports = config
