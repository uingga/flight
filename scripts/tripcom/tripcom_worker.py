"""Worker transaction. No writer/deploy credential and no autonomous retry."""
import json
from datetime import datetime
from pathlib import Path
from tripcom_runner import run_admitted
from tripcom_coordinator import KST


def require_local_admission_ready(state_root):
    root = Path(state_root)
    if (root / 'active.lock').exists():
        raise RuntimeError('local_run_active')
    circuit = root / 'circuit.json'
    if circuit.exists():
        state = json.loads(circuit.read_text(encoding='utf-8'))
        if datetime.now(KST) < datetime.fromisoformat(state['nextProbeAt']):
            raise RuntimeError('access_circuit_open')


def execute_worker(*, call, slot, host, state_root, browser_factory, close_browser,
                   runner=run_admitted):
    # A local circuit or existing local owner must stop before central admission.
    # Otherwise a preflight failure strands the shared slot until reconciliation.
    require_local_admission_ready(state_root)
    ticket = call('acquire', slot=slot)['ticket']
    if ticket.get('host') != host or ticket.get('slot') != slot:
        raise RuntimeError('admission_identity_mismatch')

    def assert_owner(run_id, worker):
        if run_id != slot or worker != host:
            raise RuntimeError('local_identity_mismatch')
        if call('check', ticket=ticket).get('owned') is not True:
            raise RuntimeError('central_ownership_unconfirmed')

    artifact = runner(state_root=state_root, run_id=slot, host=host,
        browser_factory=browser_factory, close_browser=close_browser,
        assert_owner=assert_owner)
    # run_admitted returns only after browser cleanup succeeds.
    if artifact.get('status') == 'blocked':
        call('block', ticket=ticket, reason='access_denied')
    received = call('receive', ticket=ticket, artifact=artifact, cleanupConfirmed=True)
    if not received.get('artifactHash') or received.get('publication') != 'pending':
        raise RuntimeError('receipt_unconfirmed')
    return {'artifactHash': received['artifactHash'], 'publication': 'pending'}
