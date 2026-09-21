"""Worker transaction. No writer/deploy credential and no autonomous retry."""
from tripcom_runner import run_admitted


def execute_worker(*, call, slot, host, state_root, browser_factory, close_browser,
                   runner=run_admitted):
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
