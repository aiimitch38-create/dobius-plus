#!/usr/bin/env bash
set -euo pipefail

# Create a Hermes "lead" profile for one Dobius project.
#
#   scripts/hermes/create-lead-profile.sh <slug>
#
# Makes the Hermes profile `lead-<slug>` by cloning Adam's provider setup
# (config.yaml, .env, skills), then replaces SOUL.md and adds AGENTS.md from
# resources/hermes-lead-profile/ so the new profile is a lead, not a copy of
# Adam. Never touches ~/.hermes/config.yaml, Adam's profile, or Adam's kanban.
# Carson runs this by hand; builders and agents do not.

usage() {
  echo "usage: $(basename "$0") <slug>" >&2
  echo "  slug: ^[a-z0-9][a-z0-9_-]{0,63}\$  (profile becomes lead-<slug>)" >&2
  exit 2
}

[[ $# -eq 1 ]] || usage
slug="$1"

if [[ ! "$slug" =~ ^[a-z0-9][a-z0-9_-]{0,63}$ ]]; then
  echo "error: slug '$slug' is invalid (want ^[a-z0-9][a-z0-9_-]{0,63}\$)" >&2
  exit 2
fi

profile="lead-${slug}"
source_profile="adam"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
resources_dir="$(cd "${script_dir}/../../resources/hermes-lead-profile" && pwd)"
hermes_home="${HERMES_HOME:-$HOME/.hermes}"
profile_dir="${hermes_home}/profiles/${profile}"
source_dir="${hermes_home}/profiles/${source_profile}"

command -v hermes >/dev/null 2>&1 || { echo "error: 'hermes' is not on PATH" >&2; exit 1; }

for f in SOUL.md AGENTS.md; do
  [[ -f "${resources_dir}/${f}" ]] || { echo "error: missing ${resources_dir}/${f}" >&2; exit 1; }
done

[[ -d "${source_dir}" ]] || { echo "error: source profile '${source_profile}' not found at ${source_dir}" >&2; exit 1; }

# Refuse to overwrite: check the directory and the registry.
if [[ -e "${profile_dir}" ]]; then
  echo "error: profile '${profile}' already exists at ${profile_dir}; refusing to overwrite" >&2
  exit 1
fi
if hermes profile list 2>/dev/null | grep -Eq "(^|[^a-z0-9_-])${profile}([^a-z0-9_-]|$)"; then
  echo "error: profile '${profile}' is already listed by 'hermes profile list'; refusing to overwrite" >&2
  exit 1
fi

echo "==> creating Hermes profile '${profile}' (clone of '${source_profile}', no wrapper alias)"
# --clone-from implies --clone: copies config.yaml, .env, SOUL.md and skills.
# Messaging channels (bot tokens, allowlists) are NOT copied by default.
hermes profile create "${profile}" \
  --clone-from "${source_profile}" \
  --no-alias \
  --description "Dobius lead for project '${slug}'. Pulls cards assigned to ${profile} from the Dobius work board, splits them into child cards, spawns worker consoles, verifies and completes. Carson is the only approver."

[[ -d "${profile_dir}" ]] || { echo "error: hermes reported success but ${profile_dir} does not exist" >&2; exit 1; }

echo "==> installing lead SOUL.md and AGENTS.md"
cp "${resources_dir}/SOUL.md"   "${profile_dir}/SOUL.md"
cp "${resources_dir}/AGENTS.md" "${profile_dir}/AGENTS.md"
chmod 600 "${profile_dir}/SOUL.md" "${profile_dir}/AGENTS.md"

# The clone brings Adam's identity files along with his config. Drop the ones
# that would make the lead think it is Adam. Only files we know are Adam's.
for f in ROLE.md PLAYBOOK.md RULES.md; do
  if [[ -f "${profile_dir}/${f}" ]]; then
    rm -f "${profile_dir}/${f}"
    echo "    removed cloned ${f} (Adam-specific)"
  fi
done

echo "==> profile description"
hermes profile describe "${profile}"

echo "==> profile details"
hermes profile show "${profile}"

cat <<EOF

Done. Profile '${profile}' is at ${profile_dir}

Next steps (run inside the project repo, in a Dobius terminal):
  1. dobius lead init --worktree active
       writes .dobius/lead.json ({profile: "${profile}", projectId: "${slug}"}) and .dobius/ORCHESTRATOR.md
  2. Edit .dobius/ORCHESTRATOR.md, section "Project specifics"
  3. dobius lead start --worktree active
  4. Hand it a card:
       dobius tasks create --title "<summary>" --project ${slug} \\
         --assignee ${profile} --assignee-kind hermes-profile --status todo --created-by carson --json

Runbook: docs/reference/leads/LEADS.md
Note: the clone copied Adam's provider credentials (.env). Review ${profile_dir}/.env if this lead should use different keys.
EOF
