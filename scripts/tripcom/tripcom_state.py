"""Durable local execution state. A central admission grant is required separately.

Never use a Dropbox-synced directory as a cross-host lock. Interrupted requests
remain unknown and cannot be repeated by a resume of the same run.
"""
import hashlib
import json
import os
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    for attempt in range(5):
        try:
            os.replace(temporary, path)
            break
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.02)


class RunState:
    def __init__(self, root, run_id, host, destinations, now=None):
        if not run_id or not host or not destinations or len(destinations) != len(set(destinations)):
            raise ValueError("invalid_run_identity")
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.run_id = run_id
        self.host = host
        self.destinations = list(destinations)
        self.now = now or (lambda: datetime.now(KST))
        self.path = self.root / "runs" / (hashlib.sha256(run_id.encode()).hexdigest() + ".json")
        self.document = None

    def check_circuit(self):
        path = self.root / "circuit.json"
        if path.exists():
            circuit = json.loads(path.read_text(encoding="utf-8"))
            if self.now() < datetime.fromisoformat(circuit["nextProbeAt"]):
                raise RuntimeError("access_circuit_open")

    @contextmanager
    def acquire(self):
        lock = self.root / "active.lock"
        # Do not guess that an existing lock is stale or remove another owner.
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            os.write(descriptor, json.dumps({"runId": self.run_id, "host": self.host, "pid": os.getpid()}).encode())
            os.fsync(descriptor)
            self.check_circuit()
            if self.path.exists():
                self.document = json.loads(self.path.read_text(encoding="utf-8"))
                if (self.document["host"] != self.host or self.document["destinations"] != self.destinations
                        or self.document["runId"] != self.run_id):
                    raise RuntimeError("run_identity_changed")
                if self.document["status"] != "running":
                    raise RuntimeError("run_already_terminal")
                for entry in self.document["entries"].values():
                    if entry["status"] == "inflight":
                        entry["status"] = "unknown"
                self.save()
            else:
                self.document = {"version": 1, "runId": self.run_id, "host": self.host,
                    "destinations": self.destinations, "startedAt": self.now().isoformat(),
                    "status": "running", "entries": {}, "publication": "not_submitted"}
                self.save()
            yield self
        finally:
            os.close(descriptor)
            lock.unlink()

    def save(self):
        atomic_json(self.path, self.document)

    def pending(self):
        return [key for key in self.destinations if key not in self.document["entries"]]

    def start_city(self, key):
        self.check_circuit()
        if key not in self.pending() or self.document["status"] != "running":
            raise RuntimeError("city_not_eligible")
        self.document["entries"][key] = {"status": "inflight", "startedAt": self.now().isoformat()}
        self.save()  # Persist before any external request.

    def finish_city(self, key, result):
        if self.document["entries"].get(key, {}).get("status") != "inflight":
            raise RuntimeError("city_not_inflight")
        self.document["entries"][key] = {"status": "done", "result": result, "finishedAt": self.now().isoformat()}
        self.save()

    def block(self, reason):
        atomic_json(self.root / "circuit.json", {"runId": self.run_id, "reason": reason,
            "observedAt": self.now().isoformat(), "nextProbeAt": (self.now() + timedelta(hours=24)).isoformat()})
        self.document["status"] = "blocked"
        self.save()

    def stop_inconclusive(self, reason):
        if self.document["status"] != "running" or any(
                entry["status"] == "inflight" for entry in self.document["entries"].values()):
            raise RuntimeError("run_not_stoppable")
        self.document["status"] = "inconclusive"
        self.document["stopReason"] = reason
        self.document["finishedAt"] = self.now().isoformat()
        self.save()

    def finish(self):
        if self.pending() or any(e["status"] == "inflight" for e in self.document["entries"].values()):
            raise RuntimeError("run_incomplete")
        self.document["status"] = "collected_with_unknown" if any(e["status"] == "unknown" for e in self.document["entries"].values()) else "collected"
        self.document["finishedAt"] = self.now().isoformat()
        self.save()

