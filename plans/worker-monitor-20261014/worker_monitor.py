#!/usr/bin/env python3
"""Observe this authorized build only; notify ROOT, never assign or finish jobs."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

CLI = '/usr/local/bin/dobius'
MAX_REPORT_BYTES = 2_000_000


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def cli(*args):
    environment = dict(os.environ)
    for key in ('DOBIUS_ENVIRONMENT', 'DOBIUS_PAIRING_CODE', 'DOBIUS_REMOTE_PAIRING'):
        environment.pop(key, None)
    response = subprocess.run([CLI, *args, '--json'], env=environment,
                              capture_output=True, text=True, timeout=15)
    if response.returncode or len(response.stdout) > 2_000_000:
        raise RuntimeError('CLI unavailable: ' + ' '.join(args[:2]))
    value = json.loads(response.stdout)
    if not value.get('ok'):
        raise RuntimeError('CLI refused: ' + ' '.join(args[:2]))
    return value


def binding_matches(terminal, expected):
    return bool(terminal and terminal.get('connected') and all(
        terminal.get(key) == expected.get(key) for key in ('handle', 'tabId', 'leafId')))


def report_hash(path):
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_REPORT_BYTES:
            return None
        body = path.read_bytes()
        if not isinstance(json.loads(body), dict):
            return None
        return hashlib.sha256(body).hexdigest()
    except (OSError, ValueError):
        # Worker writes may be briefly incomplete; retain the last good digest.
        return None


def collect(config, previous, terminals, tasks, inbox, gates, reports, now, agents=None):
    """Quiet output is a check request, never evidence of failure or completion."""
    signals = {}
    workers = {}
    by_handle = {t['handle']: t for t in terminals}
    by_task = {t['id']: t for t in tasks}
    agents = agents or {}
    for role, worker in config['workers'].items():
        terminal = by_handle.get(worker['handle'])
        connected = binding_matches(terminal, worker)
        task = by_task.get(worker.get('task_id'))
        status = task.get('status') if task else 'untracked'
        agent = agents.get(worker['tabId'] + ':' + worker['leafId'], {})
        workers[role] = {'connected': connected, 'task_id': worker.get('task_id'), 'agent_state': agent.get('state', 'unknown'),
                         'task_status': status, 'last_output_at': terminal.get('lastOutputAt') if terminal else None}
        if not connected:
            signals['disconnect:' + role] = {'kind': 'worker_disconnected', 'role': role}
        if agent.get('state') == 'permission':
            signals['permission:' + role] = {'kind': 'worker_needs_permission', 'role': role}
        if task and status == 'dispatched' and agent.get('state') == 'done' and now - worker.get('assigned_at', now) > 60:
            signals['done:' + task['id']] = {'kind': 'worker_finished_needs_reconciliation', 'role': role, 'task_id': task['id']}
        if worker.get('task_id') and not task:
            signals['missing:' + role] = {'kind': 'tracked_job_missing', 'role': role, 'task_id': worker['task_id']}
        if task and status in ('failed', 'blocked'):
            signals['blocked:' + task['id']] = {'kind': 'job_requires_attention', 'role': role,
                                               'task_id': task['id'], 'status': status}
        if task and status == 'ready':
            signals['ready:' + task['id']] = {'kind': 'ready_job_unassigned', 'role': role, 'task_id': task['id']}
        if task and status == 'dispatched' and connected:
            if worker.get('delivery_verified') is False and now - worker.get('assigned_at', now) >= config.get('delivery_grace_seconds', 60):
                signals['delivery:' + task['id']] = {'kind': 'dispatch_delivery_needs_readback', 'role': role,
                    'task_id': task['id'], 'instruction': 'Check whether the exact prompt is still drafted. Never re-paste blindly or duplicate the task.'}
            last = (terminal.get('lastOutputAt') or 0) / 1000
            baseline = max(last, worker.get('assigned_at', now))
            if now - baseline >= config.get('quiet_seconds', 600):
                signals['quiet:' + task['id']] = {'kind': 'job_quiet_check_required', 'role': role,
                    'task_id': task['id'], 'instruction': 'Inspect actual worker and report; do not auto-restart or duplicate dispatch.'}
        if task and status == 'completed' and not worker.get('hold_reason'):
            signals['next:' + task['id']] = {'kind': 'completed_job_needs_next_step', 'role': role, 'task_id': task['id']}
    delivered = previous.get('delivered_reports', {})
    invalid_since = previous.setdefault('invalid_report_since', {})
    for role, digest in reports.items():
        if digest is None:
            first_seen = invalid_since.setdefault(role, now)
            if now - first_seen >= config.get('invalid_report_grace_seconds', 60):
                signals['invalid_report:' + role] = {'kind': 'worker_report_unreadable', 'role': role,
                    'instruction': 'Report stayed unreadable across retries; retain previous evidence and never auto-complete.'}
        else:
            invalid_since.pop(role, None)
        if digest and delivered.get(role) != digest:
            signals['report:' + role + ':' + digest] = {'kind': 'worker_report_changed', 'role': role, 'sha256': digest,
                'instruction': 'Read report, verify source freeze and verdict, then reconcile the exact task. Never auto-complete.'}
    seen = set(previous.get('seen_messages', []))
    for message in inbox:
        if message.get('id') not in seen and message.get('type') in ('worker_done', 'escalation', 'decision_gate'):
            signals['message:' + message['id']] = {'kind': 'orchestrator_message', 'id': message['id'],
                'type': message.get('type'), 'subject': str(message.get('subject', ''))[:180]}
    scoped_ids = {w.get('task_id') for w in config['workers'].values()}
    scoped_ids.update(config.get('queue_task_ids', []))
    for task_id in config.get('queue_task_ids', []):
        task = by_task.get(task_id)
        if not task:
            signals['missing:' + task_id] = {'kind': 'queued_job_missing', 'task_id': task_id}
            continue
        if task['status'] == 'ready':
            signals['ready:' + task_id] = {'kind': 'ready_job_needs_dispatch', 'task_id': task_id}
        elif task['status'] == 'pending':
            deps = task.get('deps', '[]')
            deps = json.loads(deps) if isinstance(deps, str) else deps
            if all(by_task.get(dep, {}).get('status') == 'completed' for dep in deps):
                signals['deps:' + task_id] = {'kind': 'dependencies_finished_job_needs_ready', 'task_id': task_id}
        elif task['status'] in ('blocked', 'failed'):
            signals['blocked:' + task_id] = {'kind': 'queued_job_requires_attention', 'task_id': task_id, 'status': task['status']}
    for gate in gates:
        if gate.get('task_id') in scoped_ids:
            signals['gate:' + gate['id']] = {'kind': 'pending_decision_gate', 'id': gate['id'], 'task_id': gate.get('task_id')}
    notices = previous.get('notified_at', {})
    events = [dict(value, signal_key=key) for key, value in signals.items()
              if now - notices.get(key, 0) >= config.get('reminder_seconds', 300)]
    return workers, signals, events


def send_notification(config, state, events, persist, call=cli):
    """Save paste/submit phases so an uncertain Enter never duplicates a paste."""
    manager = config['manager']['handle']
    pending = state.get('pending_notification')
    if pending is None:
        pending = {'phase': 'new', 'events': events[:12], 'created_at': time.time()}
        state['pending_notification'] = pending
        persist()
    bound = ('terminal', 'send', '--terminal', manager, '--expected-runtime-id', config['runtime_id'],
             '--require-agent-status', 'sendable')
    if pending['phase'] == 'new':
        notice = ('DOBIUS_BUILD_MONITOR: ' + json.dumps(pending['events'], separators=(',', ':')) +
                  '. Use Dobius CLI/Orchestrator to inspect and advance this authorized build. '
                  'AWS deferred; historical Storage paused. Do not duplicate active work.')
        # Persist before the write: a timeout may mean the write succeeded.
        pending['phase'] = 'paste_uncertain'
        persist()
        response = call(*bound, '--text', notice)
        send = response.get('result', {}).get('send', {})
        if not send.get('accepted'):
            pending['phase'] = 'new'
            persist()
            return False
        pending['phase'] = 'pasted'
        persist()
    if pending['phase'] == 'pasted':
        time.sleep(1)
        pending['phase'] = 'submit_uncertain'
        persist()
        response = call(*bound, '--enter')
        if not response.get('result', {}).get('send', {}).get('accepted'):
            pending['phase'] = 'pasted'
            persist()
            return False
        state['last_delivered_events'] = pending['events']
        state['pending_notification'] = None
        persist()
        return True
    # Explicit ROOT reconciliation required for a timed-out, ambiguous write.
    return False


def cycle(config, state, directory):
    now = time.time()
    health = {'pid': os.getpid(), 'checked_at': now, 'interval_seconds': config.get('interval_seconds', 30)}
    if (directory / 'PAUSE').exists():
        return dict(health, status='paused')
    runtime = cli('status')
    if runtime.get('_meta', {}).get('runtimeId') != config['runtime_id']:
        return dict(health, status='runtime_binding_changed_requires_root')
    terminals = cli('terminal', 'list')['result']['terminals']
    if not binding_matches(next((t for t in terminals if t['handle'] == config['manager']['handle']), None), config['manager']):
        return dict(health, status='manager_binding_unavailable')
    tasks = cli('orchestration', 'task-list')['result']['tasks']
    workspaces = cli('worktree', 'ps', '--limit', '12')['result']['worktrees']
    workspace = next((w for w in workspaces if w['worktreeId'] == config['worktree_id']), {})
    agents = {a['paneKey']: a for a in workspace.get('agents', [])}
    inbox = cli('orchestration', 'inbox', '--terminal', config['manager']['handle'], '--limit', '100')['result']['messages']
    gates = cli('orchestration', 'gate-list', '--status', 'pending')['result']['gates']
    reports = {role: report_hash(Path(config['repository']) / worker['report'])
               for role, worker in config['workers'].items()}
    workers, signals, events = collect(config, state, terminals, tasks, inbox, gates, reports, now, agents)
    persist = lambda: write_json(directory / 'state.json', state)
    if events or state.get('pending_notification'):
        if send_notification(config, state, events, persist):
            delivered_events = state.pop('last_delivered_events', [])
            notices = state.setdefault('notified_at', {})
            for event in delivered_events:
                notices[event['signal_key']] = now
                if event['kind'] == 'worker_report_changed':
                    state.setdefault('delivered_reports', {})[event['role']] = event['sha256']
                if event['kind'] == 'orchestrator_message':
                    state['seen_messages'] = (state.get('seen_messages', []) + [event['id']])[-100:]
            state['notified_at'] = {k: v for k, v in notices.items() if now - v < 86400}
            state['last_delivery_at'] = now
            with (directory / 'events.jsonl').open('a') as out:
                out.write(json.dumps({'at': now, 'events': delivered_events}) + '\n')
            if (directory / 'events.jsonl').stat().st_size > 1_000_000:
                (directory / 'events.jsonl').replace(directory / 'events.previous.jsonl')
    if now - state.get('last_dashboard_at', 0) >= 60:
        with (directory / 'events.jsonl').open('a') as out:
            out.write(json.dumps({'at': now, 'event': 'monitor_heartbeat', 'workers': workers,
                                 'notification_phase': (state.get('pending_notification') or {}).get('phase')}) + '\n')
        state['last_dashboard_at'] = now
    if (directory / 'events.jsonl').exists() and (directory / 'events.jsonl').stat().st_size > 1_000_000:
        (directory / 'events.jsonl').replace(directory / 'events.previous.jsonl')
    persist()
    uncertain = (state.get('pending_notification') or {}).get('phase') in ('paste_uncertain', 'submit_uncertain')
    return dict(health, status='notification_delivery_requires_root' if uncertain else 'watching', workers=workers, pending_events=events,
                notification=state.get('pending_notification'), last_delivery_at=state.get('last_delivery_at'),
                scope='current build only; no assignment or completion authority')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--state-dir', type=Path, required=True)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    args.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (args.state_dir / 'process.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        state = read_json(args.state_dir / 'state.json', {})
        while True:
            config = read_json(args.config)
            try:
                health = cycle(config, state, args.state_dir)
            except Exception as error:
                health = {'pid': os.getpid(), 'checked_at': time.time(), 'status': 'retrying', 'error': str(error)[:300]}
            write_json(args.state_dir / 'health.json', health)
            if args.once:
                return
            time.sleep(max(10, config.get('interval_seconds', 30)))


if __name__ == '__main__':
    main()
