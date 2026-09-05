#!/usr/bin/env bash
set -euo pipefail

# Persistent host, not a snapshot-based sandbox: the box is always on and the
# repo already lives there, so this just reports the SSH connection details
# Dobius+ needs to dial in. Nothing to provision or tear down (destroy: none).
host="100.98.24.1" # Tailscale address for dobius-linux
port=22
username="root"
identity_file="$HOME/.ssh/dobius_box"
project_root="/opt/dobius-build"

node -e '
const [host, port, username, identityFile, projectRoot] = process.argv.slice(1)
console.log(JSON.stringify({
  schemaVersion: 1,
  connection: {
    type: "ssh",
    projectRoot,
    target: {
      label: "hostinger-linux-box",
      host,
      port: Number(port),
      username,
      identityFile
    }
  }
}))
' "$host" "$port" "$username" "$identity_file" "$project_root"
