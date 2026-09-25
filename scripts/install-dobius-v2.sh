#!/bin/bash
# RETIRED (BUILD-043, bugs #100 #103 #112). This script used to `rm -rf` the
# installed app before copying the new one (a failed copy left no app at all),
# wrote no provenance, took no lock and had no downgrade guard — and because it
# carried the app path inside the script, the install-gate hook never saw it.
# There is now exactly ONE install path: scripts/install-dobius-gated.sh.
echo "install-dobius-v2.sh is retired. Build, then install with the gated installer:" >&2
echo "  pnpm --dir dobius run build:unpack" >&2
echo "  scripts/install-dobius-gated.sh dobius/dist/mac-arm64/Dobius+.app [--take-over] [--allow-downgrade]" >&2
exit 1
