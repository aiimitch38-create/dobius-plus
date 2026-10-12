# Automatic cloud backups for Dobius

Dobius source, unfinished changes, Git metadata, Obsidian, and task/session state can be backed up independently of the desktop application. A macOS LaunchAgent and a VPS systemd timer run every 30 minutes. They do not resume development workers or depend on the failed external drive.

The backup is encrypted by restic before it reaches S3. Each machine uses a separate repository prefix and encryption key. A failed or incomplete snapshot is never reported as healthy. Missing required sources stop the job before retention can remove older snapshots.

## Install

The scripts belong in the canonical app's `config/scripts/cloud-backup` directory. The installer downloads restic 0.19.1 from its official GitHub release and verifies its published SHA-256 before executing it. It copies only the backup runtime into a private operational directory.

On the laptop:

```sh
python3 dobius/config/scripts/cloud-backup/install_schedule.py --profile laptop
```

On the VPS, run the same installer with `--profile vps`. The default operational directories are:

- Mac: `~/Library/Application Support/Dobius Cloud Backup`
- VPS: `/opt/dobius-cloud-backup`

Installations preserve existing configuration and encryption keys. Initial installation starts the schedule, but its status remains `waiting_for_configuration` until S3 is configured and a real backup succeeds.

The laptop defaults include the canonical Dobius repository, Obsidian, orchestration preservation records, the surviving recovery worktree, Documents, Desktop, and Dobius application data. The VPS includes its older source/build copy, installed Linux app, Obsidian, Dobius home directory, and a future `/srv/dobius/workspaces` directory when present. Photos, Movies, Music, other project folders, and out-of-tree worker locations are not included by default: add explicit source entries to `config.json` if they should be protected. Required sources may never silently disappear; mark a source optional only when its absence is expected.

Generated dependencies, caches, and build output directories are excluded. Finished release artifacts should use a dedicated explicit source folder with exclusions adjusted to include it. This job does not publish releases or launch builds. Live databases require an application-consistent export included as a source; file snapshots alone do not promise database consistency.

## Connect from Dobius settings

Open **Settings → Advanced → AWS cloud backups** on the laptop. Enter your existing S3 bucket, its AWS region, the access key ID, and the secret access key. Add a session token only if using temporary credentials. Click **Connect and enable backups**. The app automatically installs the verified backup runtime if needed, tests access, initializes its encrypted repository when necessary, enables the OS schedule, and starts a backup with integrity and restore checks. Setup runs independently of the app window, with progress persisted across app restarts.

The section shows connection errors, current stage, last completed backup, last restore check, and exactly which source folders are configured. **Back up now** starts an extra snapshot. **Pause backups** stops future scheduled work without deleting cloud snapshots; **Resume backups** starts a backup immediately. An operation already underway must finish before changing the connection or schedule. **Save recovery key** writes a private recovery-key export through the native save dialog; put a separate copy in your password manager.

Credentials are sent to the local worker over stdin, never shell arguments, telemetry, general settings, browser pairing, or returned status. Credential files have mode 0600 inside a 0700 directory; they are access restricted, not OS-keychain encrypted. This allows the OS job to run while Dobius is closed. Secret fields clear immediately after submission. A rejected connection leaves the prior working destination and credentials intact. No UI status says a backup is verified before the runner completes its required checks.

Desktop setup currently supports macOS and Linux servers running as root. Windows and paired browser/phone clients show a descriptive unsupported state and cannot collect AWS credentials. SSH/VPS projects are not read through the laptop settings flow: configure the separate VPS installation directly. This control does not migrate project execution to AWS, create billable buckets, or delete local originals. When preparing a new laptop installation, it includes registered local project roots, application data, and optional Obsidian/Documents/Desktop folders; existing source configuration is preserved and displayed.

## Activate S3

Create a dedicated private S3 bucket in the chosen region. Keep public access blocked, enable S3 versioning, and use a backup identity limited to that bucket. It needs bucket listing/location access and object Get/Put/Delete access within the appropriate machine's prefix. Restic requires deleting lock objects; retention/prune also needs delete access to its repository objects. Avoid allowing bucket deletion or permanent deletion of S3 object versions. Configure noncurrent-version retention separately so versioning costs are bounded; never expire current restic repository objects with an S3 lifecycle policy.

Run `configure_destination.py --config CONFIG --bucket BUCKET --region REGION` on each machine. It prompts for credentials without echoing them and saves them with mode 0600, initializes the dedicated encrypted repository if necessary, and performs the first backup and restore verification automatically. Use `--configure-only` to save configuration without activating it. Do not paste keys into chat, Git, or command arguments. Expiring credentials need an automatic refresh mechanism; the simple credential-file setup does not refresh them. Use a dedicated, limited backup identity and rotate its credentials, or replace the credential file with a managed refresh mechanism before relying on temporary keys.

The setup command normally handles activation. For manual diagnostics, initialize a new repository once, force a backup, or inspect its status:

```sh
python3 RUNTIME/backup_runner.py --config CONFIG init
python3 RUNTIME/backup_runner.py --config CONFIG run
python3 RUNTIME/backup_runner.py --config CONFIG status
```

Save each machine's `secrets/recovery-password` in a separate password manager before depending on the backup. Keeping the only recovery key on the machine being backed up is insufficient. Neither the password nor AWS credential files are uploaded by the default source list.

After initialization and its first successful verification, the installed timer handles future backups automatically. A laptop must be awake and connected. Launchd runs the initial job at login and repeats it while awake; missed intervals are coalesced after wake. The VPS calendar timer is persistent and catches a missed run after reboot. Credentials becoming available are picked up on the next run.

## Verification, retention, and failures

- First backup: read all repository data and restore a verification file, comparing its bytes with the original.
- Every week: read a 5% data sample and repeat the restore check.
- Approximately monthly: read all repository data again, on the next due weekly check.
- Daily: retain 30 daily, 12 weekly, and 12 monthly snapshots, then prune unused repository data. S3 noncurrent object versions follow the bucket's separate policy.
- Jobs are locked against overlapping runs. Restic commands have a two-hour limit and terminate their process group on timeout. The runner never force-unlocks a repository.
- Failure is saved to `state/status.json`. macOS issues a notification on a new failure/configuration state. VPS failures appear in the systemd journal and state file. External email/phone alert delivery is not configured.

`last_uploaded_at` means restic returned a complete snapshot. `last_backup_at` is recorded only after required verification and retention succeed. A canary restore checks the automated recovery path; it does not establish that every application or file can be restored successfully. Periodically restore a real project into a separate directory and run its checks. Do not remove local originals until initial source backup, restore, recovery-key storage, and AWS access are verified.

Inspect the Mac schedule with `launchctl print gui/$(id -u)/com.verlosolutions.dobius.cloud-backup`. Inspect the VPS schedule with `systemctl status dobius-cloud-backup.timer` and its last run with `journalctl -u dobius-cloud-backup.service`. Do not confuse a loaded timer with a completed cloud backup: use `state/status.json`.

## Tests

Run `python3 -m unittest discover -s dobius/config/scripts/cloud-backup -p 'test_*.py'`. Set `DOBIUS_TEST_RESTIC` to the verified restic executable to also test real encrypted, versioned backup/restore, preservation of unfinished work and Git metadata, dependency exclusion, and rejection of a wrong recovery key. Tests use temporary local repositories and never contact S3.

References: [restic S3 repositories](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html), [restic retention](https://restic.readthedocs.io/en/stable/060_forget.html), [S3 versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html), [LaunchAgent scheduling](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html).
