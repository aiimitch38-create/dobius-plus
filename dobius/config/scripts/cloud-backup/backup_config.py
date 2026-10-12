"""Configuration and private, atomic state for automatic Dobius backups."""
import json
import os
import re
import stat
from datetime import datetime, timezone
from pathlib import Path


class ConfigurationError(Exception):
    pass


def atomic_json(path, document):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".new")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(document, stream, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return {} if default is None else default


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def private_file(path):
    path = Path(path)
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        raise ConfigurationError("A required credential or encryption-key file is missing.")
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid():
        raise ConfigurationError("Credential files must be regular files owned by this user.")
    if metadata.st_mode & 0o077:
        raise ConfigurationError("Credential files must have mode 0600 or stricter.")
    return path


def validate(config):
    if config.get("version") != 1:
        raise ConfigurationError("Unsupported backup configuration version.")
    state = Path(config.get("state_directory", ""))
    if not state.is_absolute():
        raise ConfigurationError("The state directory must be absolute.")
    repository = config.get("repository")
    if not repository:
        raise ConfigurationError("AWS backup destination has not been configured.")
    if config.get("test_local_repository"):
        if not Path(repository).is_absolute():
            raise ConfigurationError("Test repository must be absolute.")
    elif not re.fullmatch(r"s3:https://s3\.[a-z0-9-]+\.amazonaws\.com/[a-z0-9.-]+/[a-zA-Z0-9/_-]+", repository):
        raise ConfigurationError("Use a regional HTTPS S3 repository with a dedicated prefix.")
    executable = Path(config.get("restic_binary", ""))
    if not executable.is_absolute() or not executable.is_file() or not os.access(executable, os.X_OK):
        raise ConfigurationError("The verified restic executable is missing.")
    private_file(config["password_file"])
    environment = os.environ.copy()
    environment.pop("RESTIC_PASSWORD", None)
    environment.pop("RESTIC_PASSWORD_COMMAND", None)
    environment.update(RESTIC_REPOSITORY=repository, RESTIC_PASSWORD_FILE=config["password_file"])
    environment["GOMEMLIMIT"] = "384MiB"
    credentials = config.get("credentials_file")
    if credentials:
        keys = read_json(private_file(credentials))
        for source, destination in [("access_key_id", "AWS_ACCESS_KEY_ID"), ("secret_access_key", "AWS_SECRET_ACCESS_KEY"), ("session_token", "AWS_SESSION_TOKEN")]:
            value = keys.get(source)
            if value:
                environment[destination] = value
            else:
                environment.pop(destination, None)
        if not environment.get("AWS_ACCESS_KEY_ID") or not environment.get("AWS_SECRET_ACCESS_KEY"):
            raise ConfigurationError("AWS credentials are incomplete.")
    elif not config.get("test_local_repository"):
        raise ConfigurationError("AWS backup credentials have not been configured.")
    environment["AWS_DEFAULT_REGION"] = config.get("region", "us-east-1")
    return environment


def backup_sources(config):
    paths = []
    missing = []
    for source in config.get("sources", []):
        path = Path(source["path"])
        if not path.is_absolute():
            raise ConfigurationError("Backup sources must be absolute paths.")
        if path.exists():
            paths.append(str(path))
        elif source.get("required", True):
            missing.append(str(path))
    if missing:
        raise ConfigurationError("Required backup sources are missing: " + ", ".join(missing))
    if not paths:
        raise ConfigurationError("No backup sources are available.")
    canary = Path(config["state_directory"]) / "restore-canary.txt"
    if not canary.is_file() or canary.is_symlink():
        raise ConfigurationError("The restore verification file is missing.")
    return paths + [str(canary)]
