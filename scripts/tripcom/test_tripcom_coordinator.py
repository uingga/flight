import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from tripcom_coordinator import Coordinator, KST


class CoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "central.sqlite"
        self.now = datetime(2026, 9, 21, 6, 17, tzinfo=KST)
        self.central = Coordinator(self.path, lambda: self.now)
        self.slot = self.now.isoformat()

    def artifact(self, ticket):
        return {"runId": ticket["slot"], "host": ticket["host"], "naverQueries": 0,
                "publication": "not_submitted", "flights": []}

    def test_only_scheduled_host_can_acquire(self):
        with self.assertRaisesRegex(ValueError, "wrong_scheduled_host"):
            self.central.acquire(self.slot, "C")
        self.central.check(self.central.acquire(self.slot, "B"))

    def test_other_host_cannot_run_while_prior_owner_unresolved(self):
        self.central.acquire(self.slot, "B")
        self.now = self.now.replace(hour=10, minute=12)
        with self.assertRaisesRegex(RuntimeError, "already_active"):
            self.central.acquire(self.now.isoformat(), "C")

    def test_restart_retains_lock(self):
        ticket = self.central.acquire(self.slot, "B")
        restarted = Coordinator(self.path, lambda: self.now)
        restarted.check(ticket)
        with self.assertRaisesRegex(RuntimeError, "already_active"):
            restarted.acquire(self.slot, "B")

    def test_result_saved_is_not_publication_complete(self):
        ticket = self.central.acquire(self.slot, "B")
        self.central.receive(ticket, self.artifact(ticket), True)
        self.now = self.now.replace(hour=10, minute=12)
        with self.assertRaisesRegex(RuntimeError, "already_active"):
            self.central.acquire(self.now.isoformat(), "C")

    def test_shared_block_remains_after_publication(self):
        ticket = self.central.acquire(self.slot, "B")
        self.central.block(ticket, "http_429")
        digest = self.central.receive(ticket, self.artifact(ticket), True)
        self.central.acknowledge_publication(ticket, digest, "a" * 40)
        self.now = self.now.replace(hour=10, minute=12)
        with self.assertRaisesRegex(RuntimeError, "shared_access_circuit"):
            self.central.acquire(self.now.isoformat(), "C")

    def test_unknown_cleanup_keeps_ownership(self):
        ticket = self.central.acquire(self.slot, "B")
        with self.assertRaisesRegex(ValueError, "cleanup_unconfirmed"):
            self.central.receive(ticket, self.artifact(ticket), False)
        self.central.check(ticket)

    def test_same_result_idempotent_different_result_refused(self):
        ticket = self.central.acquire(self.slot, "B")
        result = self.artifact(ticket)
        digest = self.central.receive(ticket, result, True)
        self.assertEqual(self.central.receive(ticket, result, True), digest)
        result["flights"] = [{"id": "changed"}]
        with self.assertRaisesRegex(RuntimeError, "immutable_artifact_conflict"):
            self.central.receive(ticket, result, True)

    def test_published_slot_never_recollected(self):
        ticket = self.central.acquire(self.slot, "B")
        digest = self.central.receive(ticket, self.artifact(ticket), True)
        self.central.acknowledge_publication(ticket, digest, "a" * 40)
        with self.assertRaisesRegex(RuntimeError, "already_claimed"):
            self.central.acquire(self.slot, "B")

    def test_stale_trigger_not_caught_up(self):
        self.now = self.now.replace(hour=10, minute=12)
        with self.assertRaisesRegex(ValueError, "superseded_slot"):
            self.central.acquire(self.slot, "B")

    def test_worker_identity_cannot_be_swapped(self):
        ticket = self.central.acquire(self.slot, "B")
        ticket["host"] = "C"
        with self.assertRaisesRegex(RuntimeError, "ownership_unconfirmed"):
            self.central.check(ticket)

    def test_no_quotes_can_finish_without_fake_publication(self):
        ticket = self.central.acquire(self.slot, 'B')
        artifact = {**self.artifact(ticket), 'status':'collected', 'observations':[]}
        digest = self.central.receive(ticket, artifact, True)
        self.central.finish_without_publication(ticket, digest)
        self.now = self.now.replace(hour=10, minute=12)
        self.central.acquire(self.now.isoformat(), 'C')

    def test_blocked_empty_finish_keeps_shared_circuit(self):
        ticket = self.central.acquire(self.slot, 'B')
        self.central.block(ticket, 'http_429')
        digest = self.central.receive(ticket, {**self.artifact(ticket), 'status':'blocked', 'observations':[]}, True)
        self.central.finish_without_publication(ticket, digest)
        self.now = self.now.replace(hour=10, minute=12)
        with self.assertRaisesRegex(RuntimeError, 'shared_access_circuit'):
            self.central.acquire(self.now.isoformat(), 'C')

    def test_verified_result_cannot_be_discarded_as_empty(self):
        from test_tripcom_contract import fixture
        ticket = self.central.acquire(self.slot, 'B')
        digest = self.central.receive(ticket, {**self.artifact(ticket), 'status':'collected', 'observations':[fixture()]}, True)
        with self.assertRaisesRegex(RuntimeError, 'require_publication'):
            self.central.finish_without_publication(ticket, digest)

    def test_inconclusive_empty_run_releases_slot_without_fake_publication(self):
        ticket = self.central.acquire(self.slot, 'B')
        artifact = {**self.artifact(ticket), 'status': 'inconclusive',
            'expectedCities': 40, 'attemptedCities': 3,
            'stopReason': 'repeated_outbound_cards_timeout',
            'observations': [{'city_code': code, 'status': 'collector_error',
                'reason': 'stage_timeout', 'stage': 'outbound_cards_wait'}
                for code in ('fuk', 'osa', 'tyo')]}
        digest = self.central.receive(ticket, artifact, True)
        self.central.finish_without_publication(ticket, digest)
        with self.central.transaction() as db:
            self.assertEqual(db.execute('SELECT active_slot FROM control WHERE id=1').fetchone()[0], None)
            self.assertEqual(db.execute('SELECT status FROM runs WHERE slot=?', (self.slot,)).fetchone()[0],
                             'finished_no_quotes')


if __name__ == "__main__":
    unittest.main()
