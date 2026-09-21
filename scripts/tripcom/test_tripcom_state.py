import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from tripcom_state import RunState, KST


class StateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)

    def state(self, run="slot-1"):
        return RunState(self.directory.name, run, "B", ["fuk", "osa"], lambda: datetime(2026, 9, 21, 20, 30, tzinfo=KST))

    def test_same_host_overlap_rejected(self):
        with self.state().acquire():
            with self.assertRaises(FileExistsError):
                with self.state("slot-2").acquire():
                    self.fail("must not acquire")

    def test_resume_does_not_repeat_completed_or_uncertain_city(self):
        with self.state().acquire() as state:
            state.start_city("fuk")
            state.finish_city("fuk", {"status": "search_quote_observed"})
            state.start_city("osa")
        with self.state().acquire() as state:
            self.assertEqual(state.pending(), [])
            self.assertEqual(state.document["entries"]["osa"]["status"], "unknown")
            state.finish()
            self.assertEqual(state.document["status"], "collected_with_unknown")
            self.assertEqual(state.document["publication"], "not_submitted")

    def test_block_survives_new_run(self):
        with self.state().acquire() as state:
            state.block("http_429")
        with self.assertRaisesRegex(RuntimeError, "access_circuit_open"):
            with self.state("slot-2").acquire():
                self.fail("must not acquire")

    def test_malformed_circuit_fails_closed(self):
        Path(self.directory.name, "circuit.json").write_text("invalid", encoding="utf-8")
        with self.assertRaises(ValueError):
            with self.state().acquire():
                self.fail("must not acquire")

    def test_terminal_run_not_restarted(self):
        with self.state().acquire() as state:
            for city in state.pending():
                state.start_city(city)
                state.finish_city(city, {"status": "search_quote_observed"})
            state.finish()
        with self.assertRaisesRegex(RuntimeError, "run_already_terminal"):
            with self.state().acquire():
                self.fail("must not restart")

    def test_partial_run_cannot_be_marked_complete(self):
        with self.state().acquire() as state:
            with self.assertRaisesRegex(RuntimeError, "run_incomplete"):
                state.finish()


if __name__ == "__main__":
    unittest.main()
