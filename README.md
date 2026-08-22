# Dobius+

A multi-window desktop cockpit for Claude Code: themed multi-tab terminals,
session dashboard, checkpoints, custom agents, a phone remote over
Tailscale, and multi-account Google Workspace tooling.

## Download (macOS, Apple Silicon)

**[Download Dobius+](https://github.com/statusdigitalmarketing/dobius-plus/releases/latest/download/Dobius-Plus.dmg)**

That link always serves the newest version. Open the DMG, drag Dobius+ to
Applications, launch. The app is signed and notarized, and it updates itself
automatically after that, so you install once.

## About the releases page

Every entry on the [releases page](https://github.com/statusdigitalmarketing/dobius-plus/releases)
is one version of the app; only the one marked **Latest** matters for a new
install. Inside a release, `Dobius-Plus.dmg` (or the version-stamped `.dmg`)
is the installer; the `.zip`, `.blockmap`, and `latest-mac.yml` files exist
for the auto-updater, not for humans.

## Google Workspace MCP for Claude Desktop

The repo also ships `electron/gws-mcp.mjs`, a zero-dependency MCP server
that gives Claude Desktop / Claude Code every Google Workspace API across
multiple Google accounts. Dobius+ users get a one-click setup button in
Settings; standalone (including Windows) setup lives in
[docs/GWS-MCP.md](docs/GWS-MCP.md).

## Development

```bash
npm install && npx electron-rebuild
npm run electron:dev
```

Releases ship via `./release.sh` (see `RELEASING.md`).
