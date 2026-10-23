"""Deterministic low-space state and fail-closed admission calculations."""
import math
import time

from monitor_state import MAX_SAFE_INTEGER, is_canonical_volume_id, is_cloud_id


def thresholds(policy, total):
    return {'warningBytes': max(policy['warnBytes'], math.ceil(total * policy['warnFraction'])),
            'criticalBytes': max(policy['criticalBytes'], math.ceil(total * policy['criticalFraction'])),
            'hysteresisBytes': max(policy['hysteresisBytes'], math.ceil(total * policy['hysteresisFraction']))}


def classify(free, limits, previous=None):
    critical = limits['criticalBytes']
    warning = limits['warningBytes']
    band = limits['hysteresisBytes']
    if free < critical or previous == 'critical' and free < critical + band:
        return 'critical'
    if free < warning or previous in ('warning', 'critical') and free < warning + band:
        return 'warning'
    return 'healthy'


def status_freshness(status, freshness_seconds, now=None):
    now = time.time() if now is None else now
    sampled = status.get('sampledAt') if isinstance(status, dict) else None
    if type(sampled) not in (int, float) or not math.isfinite(sampled):
        return 'unavailable'
    age = now - sampled
    if age < -5:
        return 'clock_skew'
    return 'fresh' if age <= freshness_seconds else 'stale'


def status_shape_is_valid(status):
    """Reject malformed persisted containers before any row traversal."""
    if not isinstance(status, dict):
        return False
    if (status.get('schemaVersion') != 1 or not is_cloud_id(status.get('deviceId'))
            or status.get('health') not in ('unconfigured', 'healthy', 'warning', 'critical', 'unavailable')
            or status.get('cleanupEnabled') is not False):
        return False
    roots = status.get('roots')
    volumes = status.get('volumes')
    if not isinstance(roots, list) or not isinstance(volumes, list):
        return False
    if len(roots) > 32 or len(volumes) > 32:
        return False
    root_ids = set()
    referenced_volumes = set()
    for root in roots:
        if (not isinstance(root, dict) or not isinstance(root.get('identity'), dict)
                or not is_cloud_id(root.get('id')) or root['id'] in root_ids
                or not isinstance(root.get('path'), str)
                or root.get('state') not in ('available', 'unavailable')
                or root.get('volumeId') is not None and not isinstance(root.get('volumeId'), str)):
            return False
        identity = root['identity']
        if any(type(identity.get(key)) is not int or not 0 <= identity[key] <= MAX_SAFE_INTEGER
               for key in ('device', 'inode')):
            return False
        root_ids.add(root['id'])
        if root['state'] == 'available':
            expected_volume = str(identity['device'])
            if root.get('volumeId') != expected_volume:
                return False
            referenced_volumes.add(expected_volume)
        elif root.get('volumeId') is not None:
            return False

    volume_ids = set()
    for volume in volumes:
        if (not isinstance(volume, dict) or not isinstance(volume.get('id'), str)
                or not is_canonical_volume_id(volume['id']) or volume['id'] in volume_ids
                or any(type(volume.get(key)) is not int or volume[key] < 0
                       for key in ('totalBytes', 'freeBytes', 'usedBytes'))
                or not isinstance(volume.get('thresholds'), dict)):
            return False
        volume_ids.add(volume['id'])
    if volume_ids != referenced_volumes:
        return False

    alerts = status.get('alerts', [])
    if not isinstance(alerts, list):
        return False
    for alert in alerts:
        if not isinstance(alert, dict):
            return False
        if 'rootId' in alert and (not is_cloud_id(alert['rootId']) or alert['rootId'] not in root_ids):
            return False
        if 'volumeId' in alert and (
                not is_canonical_volume_id(alert['volumeId']) or alert['volumeId'] not in volume_ids):
            return False
    consumers = status.get('topConsumers', [])
    if not isinstance(consumers, list):
        return False
    for consumer in consumers:
        if (not isinstance(consumer, dict) or not is_cloud_id(consumer.get('rootId'))
                or consumer['rootId'] not in root_ids):
            return False
    return True


def admission(status, config, root_id, estimate=None, reserved=0, now=None):
    policy = config['policy']
    freshness = status_freshness(status, policy['freshnessSeconds'], now)
    result = {'schemaVersion': 1, 'allowed': False, 'reason': freshness,
              'rootId': root_id, 'freshness': freshness}
    # Persisted JSON may be syntactically valid but have hostile/malformed row
    # shapes. Return a typed refusal instead of leaking AttributeError traces.
    if (not status_shape_is_valid(status) or status.get('schemaVersion') != 1
            or status.get('deviceId') != config['deviceId']):
        return {**result, 'reason': 'unavailable', 'freshness': 'unavailable'}
    if freshness != 'fresh':
        return result
    root = next((root for root in status.get('roots', []) if root.get('id') == root_id), None)
    if not root or root.get('state') != 'available':
        return {**result, 'reason': 'root_unavailable'}
    configured = next((root for root in config['roots'] if root['id'] == root_id), None)
    if not configured or root.get('identity') != {'device': configured['device'], 'inode': configured['inode']}:
        return {**result, 'reason': 'root_identity_changed'}
    if root.get('path') != configured['path']:
        return {**result, 'reason': 'root_identity_changed'}
    volume = next((volume for volume in status.get('volumes', []) if volume.get('id') == root.get('volumeId')), None)
    if (not volume or type(volume.get('freeBytes')) is not int or volume['freeBytes'] < 0
            or type(volume.get('totalBytes')) is not int or volume['totalBytes'] <= 0
            or volume['freeBytes'] > volume['totalBytes']
            or volume.get('state') not in ('healthy', 'warning', 'critical')
            or volume.get('id') != str(configured['device'])):
        return {**result, 'reason': 'volume_unavailable'}
    if type(reserved) is not int or reserved < 0 or estimate is not None and (type(estimate) is not int or estimate < 0):
        return {**result, 'reason': 'invalid_space_estimate'}
    chosen = policy['unknownEstimateBytes'] if estimate is None else estimate
    required = chosen + reserved + policy['safetyMarginBytes']
    limits = thresholds(policy, volume['totalBytes'])
    projected = volume['freeBytes'] - required
    # A job must leave the critical reserve even if its working-space estimate is small.
    allowed = volume.get('state') != 'critical' and projected >= limits['criticalBytes']
    return {**result, 'allowed': allowed, 'reason': 'admitted' if allowed else 'insufficient_space',
            'volumeId': volume['id'], 'estimatedWorkingBytes': chosen,
            'estimateSource': 'unknown_policy' if estimate is None else 'job',
            'reservedBytes': reserved, 'safetyMarginBytes': policy['safetyMarginBytes'],
            'requiredBytes': required, 'freeBytes': volume['freeBytes'],
            'projectedFreeBytes': projected, 'criticalReserveBytes': limits['criticalBytes']}
