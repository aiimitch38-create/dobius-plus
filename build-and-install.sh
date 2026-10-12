#!/bin/bash
# RETIRED (BUILD-043, bugs #100 #112). This script used to build a partial
# bundle and hand it to scripts/install-dobius-v2.sh, which `rm -rf`'d the
# installed app before copying and skipped every install guard. There is now
# exactly ONE install path: scripts/install-dobius-gated.sh.
#
# HISTORY: never reintroduce the root electron-builder.yml packaging path — it
# builds the LEGACY v1 app (electron/main.js, appId com.statusdigital.dobius-plus).
echo "build-and-install.sh is retired. Build, then install with the gated installer:" >&2
echo "  pnpm --dir dobius run build:unpack" >&2
echo "  scripts/install-dobius-gated.sh dobius/dist/mac-arm64/Dobius+.app [--take-over] [--allow-downgrade]" >&2
exit 1
