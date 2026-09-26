import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from tripcom_parallel_coordinator import ParallelCoordinator
from tripcom_coordinator import KST
from close_unstarted_replacement import close_unstarted_b


class ClosureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.now = datetime(2026, 9, 26, 6, 17, tzinfo=KST)
        self.slot = self.now.isoformat()
        self.coordinator = ParallelCoordinator(self.root / 'ledger.sqlite', clock=lambda: self.now)
        self.c = self.coordinator.acquire(self.slot, 'C', protocol_version=3)
        artifact = {'runId': self.slot, 'host': 'C', 'status': 'inconclusive', 'expectedCities': 10,
                    'attemptedCities': 0, 'observations': [], 'publication': 'not_submitted', 'naverQueries': 0}
        self.coordinator.receive(self.c, artifact, True)
        self.evidence = dict(id='b-on-a-20260926', bFenced=True, taskEnabled=False,
            configEnabled=False, taskRunning=False, localLock=False, localSlotPresent=False,
            fenceSha='a'*64, stateSha='b'*64)
        self.later = datetime(2026, 9, 26, 11, 0, tzinfo=KST)

    def close(self):
        return close_unstarted_b(self.coordinator, self.root, self.slot, self.evidence, self.later)

    def test_explicit_zero_request_closure_preserves_C_and_shared_fence(self):
        result = self.close()
        with self.coordinator.transaction() as db:
            self.assertEqual(db.execute('SELECT active_slot FROM control').fetchone()[0], self.slot)
            c = db.execute("SELECT artifact_hash FROM parallel_workers WHERE host='C'").fetchone()[0]
            self.assertEqual(c, result['CArtifactHash'])
            b = db.execute("SELECT artifact FROM parallel_workers WHERE host='B'").fetchone()[0]
            self.assertEqual(json.loads(b)['attemptedCities'], 0)
        pending = self.coordinator.pending_publications()
        self.assertEqual(len(pending), 1)
        self.assertEqual(json.loads(pending[0]['artifact'])['status'], 'collected_with_unknown')
        with self.assertRaises(RuntimeError):
            self.close()

    def test_claimed_B_not_closed(self):
        self.coordinator.acquire(self.slot, 'B', protocol_version=3)
        with self.assertRaisesRegex(RuntimeError, 'unclaimed_B'):
            self.close()

    def test_ambiguous_local_state_and_running_task_refused(self):
        for key in ('taskEnabled', 'configEnabled', 'taskRunning', 'localLock', 'localSlotPresent'):
            self.evidence[key] = True
            with self.assertRaisesRegex(RuntimeError, 'evidence_required'):
                self.close()
            self.evidence[key] = False

    def test_no_unfenced_or_next_day_closure(self):
        self.evidence['bFenced'] = False
        with self.assertRaises(RuntimeError):
            self.close()
        self.evidence['bFenced'] = True
        self.later = datetime(2026, 9, 27, 0, 0, tzinfo=KST)
        with self.assertRaisesRegex(RuntimeError, 'same_day'):
            self.close()

    def test_site_block_never_cleared(self):
        with self.coordinator.transaction() as db:
            db.execute('UPDATE control SET blocked_until=? WHERE id=1', ('2026-09-27T00:00:00+09:00',))
        with self.assertRaisesRegex(RuntimeError, 'circuit_open'):
            self.close()


if __name__ == '__main__':
    unittest.main()
