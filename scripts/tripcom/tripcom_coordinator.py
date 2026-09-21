"""Central-only Trip.com admission ledger; never place this DB in Dropbox.

B/C callers must reach this through an authenticated central transport. They
must not receive filesystem access to the ledger or any publisher credential.
No TTL-based ownership stealing, schedule catch-up, or alternative-host retry.
"""
import hashlib
import json
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
SCHEDULE = {"06:17": "B", "10:12": "C", "13:23": "B", "16:31": "C", "20:30": "B"}


class Coordinator:
    def __init__(self, database, clock=None):
        self.database = str(database)
        self.clock = clock or (lambda: datetime.now(KST))
        with self.transaction() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runs (
                    slot TEXT PRIMARY KEY, host TEXT NOT NULL, token_hash TEXT NOT NULL,
                    status TEXT NOT NULL, artifact TEXT, artifact_hash TEXT,
                    publication_sha TEXT, cleanup_confirmed INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS control (
                    id INTEGER PRIMARY KEY CHECK(id=1), active_slot TEXT,
                    blocked_until TEXT, block_reason TEXT
                );
                INSERT OR IGNORE INTO control(id) VALUES(1);
            """)

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(self.database, timeout=5, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA synchronous=FULL")
            db.execute("BEGIN IMMEDIATE")
            yield db
            if db.in_transaction:
                db.commit()
        except BaseException:
            if db.in_transaction:
                db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def digest(value):
        return hashlib.sha256(value.encode()).hexdigest()

    def acquire(self, slot, host):
        scheduled = datetime.fromisoformat(slot)
        if scheduled.tzinfo is None or scheduled.second or scheduled.microsecond:
            raise ValueError("invalid_scheduled_slot")
        scheduled = scheduled.astimezone(KST)
        slot = scheduled.isoformat()
        now = self.clock().astimezone(KST)
        if SCHEDULE.get(scheduled.strftime("%H:%M")) != host:
            raise ValueError("wrong_scheduled_host")
        if now < scheduled or now.date() != scheduled.date():
            raise ValueError("slot_not_due_today")
        # A late trigger must not manufacture an extra catch-up of earlier slots.
        latest = max(time for time in SCHEDULE if time <= now.strftime("%H:%M"))
        if latest != scheduled.strftime("%H:%M"):
            raise ValueError("superseded_slot")
        with self.transaction() as db:
            control = db.execute("SELECT * FROM control WHERE id=1").fetchone()
            if control["active_slot"]:
                raise RuntimeError("tripcom_already_active")
            if control["blocked_until"] and now < datetime.fromisoformat(control["blocked_until"]):
                raise RuntimeError("shared_access_circuit_open")
            if db.execute("SELECT 1 FROM runs WHERE slot=?", (slot,)).fetchone():
                raise RuntimeError("slot_already_claimed")
            token = secrets.token_urlsafe(32)
            db.execute("INSERT INTO runs(slot,host,token_hash,status) VALUES(?,?,?,?)",
                       (slot, host, self.digest(token), "running"))
            db.execute("UPDATE control SET active_slot=? WHERE id=1", (slot,))
            return {"slot": slot, "host": host, "token": token}

    def owner(self, db, ticket):
        row = db.execute("SELECT * FROM runs WHERE slot=?", (ticket["slot"],)).fetchone()
        active = db.execute("SELECT active_slot FROM control WHERE id=1").fetchone()[0]
        if (not row or active != ticket["slot"] or row["host"] != ticket["host"]
                or not secrets.compare_digest(row["token_hash"], self.digest(ticket["token"]))):
            raise RuntimeError("ownership_unconfirmed")
        return row

    def check(self, ticket):
        with self.transaction() as db:
            row = self.owner(db, ticket)
            if row["status"] != "running":
                raise RuntimeError("run_not_collecting")

    def block(self, ticket, reason):
        with self.transaction() as db:
            self.owner(db, ticket)
            until = (self.clock() + timedelta(hours=24)).isoformat()
            db.execute("UPDATE control SET blocked_until=?,block_reason=? WHERE id=1", (until, reason))
            db.execute("UPDATE runs SET status='blocked' WHERE slot=?", (ticket["slot"],))

    def receive(self, ticket, artifact, cleanup_confirmed):
        if cleanup_confirmed is not True:
            raise ValueError("worker_cleanup_unconfirmed")
        if artifact.get("runId") != ticket["slot"] or artifact.get("host") != ticket["host"]:
            raise ValueError("artifact_identity_mismatch")
        if artifact.get("publication") != "not_submitted" or artifact.get("naverQueries") != 0:
            raise ValueError("worker_exceeded_authority")
        raw = json.dumps(artifact, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        digest = self.digest(raw)
        with self.transaction() as db:
            row = self.owner(db, ticket)
            if row["artifact_hash"]:
                if row["artifact_hash"] != digest:
                    raise RuntimeError("immutable_artifact_conflict")
                return digest
            if row["status"] not in ("running", "blocked"):
                raise RuntimeError("unexpected_run_state")
            db.execute("UPDATE runs SET artifact=?,artifact_hash=?,cleanup_confirmed=1,status='awaiting_publication' WHERE slot=?",
                       (raw, digest, ticket["slot"]))
            return digest

    def acknowledge_publication(self, ticket, digest, commit_sha):
        # Central publisher calls only after common-writer readback + operational
        # verification. Never expose this operation to worker credentials.
        if len(commit_sha) != 40 or any(c not in "0123456789abcdef" for c in commit_sha):
            raise ValueError("invalid_publication_commit")
        with self.transaction() as db:
            row = self.owner(db, ticket)
            if row["status"] != "awaiting_publication" or row["artifact_hash"] != digest or not row["cleanup_confirmed"]:
                raise RuntimeError("publication_evidence_mismatch")
            db.execute("UPDATE runs SET status='published',publication_sha=? WHERE slot=?", (commit_sha, ticket["slot"]))
            db.execute("UPDATE control SET active_slot=NULL WHERE id=1")

    def finish_without_publication(self, ticket, digest):
        # Publisher revalidates the saved raw observations. Workers cannot
        # release a lock by merely reporting a zero count.
        from tripcom_publication import prepare_publication
        with self.transaction() as db:
            row = self.owner(db, ticket)
            if row['status'] != 'awaiting_publication' or row['artifact_hash'] != digest or not row['cleanup_confirmed']:
                raise RuntimeError('completion_evidence_mismatch')
            prepared = prepare_publication({'flights': []}, json.loads(row['artifact']))
            if prepared['verifiedCount']:
                raise RuntimeError('verified_quotes_require_publication')
            db.execute("UPDATE runs SET status='finished_no_quotes' WHERE slot=?", (ticket['slot'],))
            db.execute('UPDATE control SET active_slot=NULL WHERE id=1')
            # Shared blocked_until is deliberately retained after cleanup.
