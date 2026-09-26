"""Close a fenced, never-admitted B assignment; never acquire or crawl a slot.

The zero-request artifact explicitly means 'not collected'. C's immutable
artifact is preserved. The existing service remains responsible for writer
publication and releasing the active slot after verified publication.
"""
import hashlib
import json
import secrets
import sqlite3
from datetime import datetime
from pathlib import Path


def close_unstarted_b(coordinator, root, slot, evidence, now):
    if (evidence.get('id') != 'b-on-a-20260926'
            or evidence.get('bFenced') is not True
            or evidence.get('taskEnabled') is not False
            or evidence.get('configEnabled') is not False
            or evidence.get('taskRunning') is not False
            or evidence.get('localLock') is not False
            or evidence.get('localSlotPresent') is not False
            or any(not isinstance(evidence.get(key), str) or len(evidence[key]) != 64
                   or any(char not in '0123456789abcdef' for char in evidence[key])
                   for key in ('fenceSha', 'stateSha'))):
        raise RuntimeError('unstarted_B_evidence_required')
    scheduled = datetime.fromisoformat(slot)
    if scheduled.tzinfo is None or scheduled.date() != now.astimezone(scheduled.tzinfo).date() or scheduled >= now:
        raise RuntimeError('past_same_day_slot_required')
    root = Path(root)
    with coordinator.transaction() as db:
        control = db.execute('SELECT * FROM control WHERE id=1').fetchone()
        group = db.execute('SELECT * FROM parallel_slots WHERE slot=?', (slot,)).fetchone()
        workers = list(db.execute('SELECT * FROM parallel_workers WHERE slot=?', (slot,)))
        if control['active_slot'] != slot or not group or group['status'] != 'running':
            raise RuntimeError('active_unfinished_group_required')
        if control['blocked_until'] and now < datetime.fromisoformat(control['blocked_until']):
            raise RuntimeError('shared_access_circuit_open')
        if (len(workers) != 1 or workers[0]['host'] != 'C'
                or workers[0]['status'] != 'awaiting_publication'
                or workers[0]['cleanup_confirmed'] != 1 or not workers[0]['artifact_hash']):
            raise RuntimeError('only_completed_C_and_unclaimed_B_required')
        c_artifact = json.loads(workers[0]['artifact'])
        if c_artifact['status'] not in ('collected', 'collected_with_unknown', 'inconclusive'):
            raise RuntimeError('C_result_not_publishable')
        from tripcom_parallel_manifest import validate_parallel_manifest
        validate_parallel_manifest(json.loads(group['manifest']), coordinator.destinations, slot)
        from tripcom_parallel_service import parallel_group_paths, parallel_ticket_path
        _, journal = parallel_group_paths(root, coordinator, slot)
        if journal.exists():
            raise RuntimeError('existing_publication_requires_reconciliation')
        ticket = {'slot': slot, 'host': 'B', 'token': secrets.token_urlsafe(32),
                  'mode': 'parallel-v3', 'manifestHash': group['manifest_hash'],
                  'assignedCities': json.loads(group['manifest'])['B']}
        ticket_file = parallel_ticket_path(root, coordinator, ticket)
        if ticket_file.exists():
            raise RuntimeError('existing_B_ticket_requires_reconciliation')
        artifact = {'runId': slot, 'host': 'B', 'status': 'inconclusive',
                    'expectedCities': 10, 'attemptedCities': 0, 'observations': [],
                    'publication': 'not_submitted', 'naverQueries': 0,
                    'stopReason': 'physical_B_unavailable_before_admission',
                    'closedAt': now.isoformat(), 'closureEvidence': evidence}
        raw = json.dumps(artifact, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
        digest = coordinator.digest(raw)
        # Persist the publisher-only receipt before committing. It can never
        # pass check(): the row is already awaiting_publication, not running.
        ticket_file.parent.mkdir(parents=True, exist_ok=True)
        with ticket_file.open('x', encoding='utf-8') as output:
            json.dump(ticket, output)
            output.flush()
            import os
            os.fsync(output.fileno())
        db.execute("INSERT INTO parallel_workers(slot,host,token_hash,status,artifact,artifact_hash,cleanup_confirmed) VALUES(?,? ,?,'awaiting_publication',?,?,1)",
                   (slot, 'B', coordinator.digest(ticket['token']), raw, digest))
        complete = list(db.execute('SELECT * FROM parallel_workers WHERE slot=?', (slot,)))
        combined = coordinator._combine(slot, complete)
        combined['closureEvidence'] = {'B': {'reason': artifact['stopReason'], 'at': now.isoformat(),
                                           'fenceSha': evidence['fenceSha'], 'stateSha': evidence['stateSha']}}
        combined_raw = json.dumps(combined, sort_keys=True, ensure_ascii=False, separators=(',', ':'))
        db.execute("UPDATE parallel_slots SET artifact=?,artifact_hash=?,status='awaiting_publication' WHERE slot=?",
                   (combined_raw, coordinator.digest(combined_raw), slot))
        return {'slot': slot, 'status': 'awaiting_publication', 'BRequests': 0,
                'CArtifactHash': workers[0]['artifact_hash'],
                'artifactHash': coordinator.digest(combined_raw)}


def main():
    import argparse
    import sys
    parser = argparse.ArgumentParser()
    parser.add_argument('--installed-modules', required=True)
    parser.add_argument('--evidence-directory', required=True)
    parser.add_argument('--state-root', required=True)
    parser.add_argument('--slot', required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(Path(args.installed_modules).resolve(strict=True)))
    from tripcom_coordinator import KST
    from tripcom_parallel_coordinator import ParallelCoordinator
    evidence_dir = Path(args.evidence_directory).resolve(strict=True)
    fence = json.loads((evidence_dir / 'apply-fence.json').read_text(encoding='utf-8'))
    stopped = json.loads((evidence_dir / 'stopped-tripcom.json').read_text(encoding='utf-8'))
    snapshot = json.loads((evidence_dir / 'tripcom-state.json').read_text(encoding='utf-8'))
    import base64
    local_states = [json.loads(base64.b64decode(item['bytes']).decode('utf-8-sig'))
                    for item in snapshot['files'] if item['file'].startswith('runs/')]
    evidence = {'id': 'b-on-a-20260926', 'bFenced': fence.get('status') == 'fenced',
                'fenceSha': fence['fenceSha'], 'stateSha': snapshot['stateSha'],
                'taskEnabled': stopped['enabled'], 'configEnabled': stopped['configEnabled'],
                'taskRunning': stopped['state'] == 4,
                'localLock': any(item['file'].endswith('.lock') for item in snapshot['files']),
                'localSlotPresent': any(item.get('runId') == args.slot for item in local_states)}
    database = Path(args.state_root).resolve(strict=True) / 'ledger.sqlite'
    backup = evidence_dir / 'tripcom-ledger-before-closure.sqlite'
    if backup.exists():
        raise RuntimeError('existing_backup_review_before_any_retry')
    with sqlite3.connect('file:' + database.as_posix() + '?mode=ro', uri=True) as source:
        with sqlite3.connect(str(backup)) as target:
            source.backup(target)
    result = close_unstarted_b(ParallelCoordinator(database), args.state_root,
                              args.slot, evidence, datetime.now(KST))
    (evidence_dir / 'tripcom-closure.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
