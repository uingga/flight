import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from tripcom_protocol import Protocol
from tripcom_coordinator import Coordinator, KST


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.now = datetime(2026, 9, 21, 6, 17, tzinfo=KST)
        self.credentials = {"B": "b" * 32, "C": "c" * 32, "publisher": "p" * 32}
        self.protocol = Protocol(Coordinator(Path(self.directory.name) / "db", lambda: self.now), self.credentials)

    def call(self, role, request):
        return self.protocol.handle("Bearer " + self.credentials[role], json.dumps(request).encode())

    def test_unauthenticated_request_denied(self):
        self.assertEqual(self.protocol.handle("", b"{}")[0], 401)

    def test_worker_cannot_publish_or_release(self):
        for action in ("acknowledge_publication", "release", "deploy", "reset", "clear_circuit"):
            self.assertEqual(self.call("B", {"action": action})[0], 403)

    def test_host_bound_to_credential_not_payload(self):
        status, result = self.call("B", {"action": "acquire", "host": "C", "slot": self.now.isoformat()})
        self.assertEqual(status, 200)
        self.assertEqual(result["ticket"]["host"], "B")
        self.assertEqual(self.call("C", {"action": "check", "ticket": result["ticket"]})[0], 403)

    def test_publisher_cannot_start_collection(self):
        self.assertEqual(self.call("publisher", {"action": "acquire", "slot": self.now.isoformat()})[0], 403)

    def test_credentials_cannot_be_shared_between_roles(self):
        with self.assertRaisesRegex(ValueError, "distinct"):
            Protocol(self.protocol.coordinator, {"B": "x" * 32, "C": "x" * 32, "publisher": "x" * 32})

    def test_large_payload_rejected(self):
        self.assertEqual(self.protocol.handle("Bearer " + self.credentials["B"], b"x" * 2_000_001)[0], 413)


if __name__ == "__main__":
    unittest.main()
