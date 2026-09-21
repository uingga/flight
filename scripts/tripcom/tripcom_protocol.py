"""Narrow authenticated application protocol; transport installation is separate.

Inject independent worker/publisher secrets from the existing secret store.
Never reuse a Naver, GitHub, or deployment credential for worker requests.
"""
import json
import secrets


class Protocol:
    def __init__(self, coordinator, credentials):
        if set(credentials) != {"B", "C", "publisher"}:
            raise ValueError("three_scoped_credentials_required")
        if any(not isinstance(value, str) or len(value) < 32 for value in credentials.values()):
            raise ValueError("invalid_scoped_credential")
        if len(set(credentials.values())) != 3:
            raise ValueError("credentials_must_be_distinct")
        self.coordinator = coordinator
        self.credentials = dict(credentials)

    def handle(self, authorization, raw):
        role = next((key for key, value in self.credentials.items()
                     if isinstance(authorization, str) and secrets.compare_digest(authorization, "Bearer " + value)), None)
        if role is None:
            return 401, {"error": "unauthorized"}
        if not isinstance(raw, bytes) or len(raw) > 2_000_000:
            return 413, {"error": "request_too_large"}
        try:
            request = json.loads(raw)
            action = request.get("action")
            if role in ("B", "C"):
                if action not in ("acquire", "check", "block", "receive"):
                    return 403, {"error": "worker_action_forbidden"}
                if action == "acquire":
                    return 200, {"ticket": self.coordinator.acquire(request["slot"], role)}
                ticket = request["ticket"]
                if ticket.get("host") != role:
                    return 403, {"error": "worker_identity_mismatch"}
                if action == "check":
                    self.coordinator.check(ticket)
                    return 200, {"owned": True}
                if action == "block":
                    # Persist classification only, never arbitrary exception URLs
                    # or browser tokens in a user-visible restriction reason.
                    reason = request.get("reason")
                    if reason not in ("http_401", "http_403", "http_429", "captcha", "access_denied"):
                        return 400, {"error": "invalid_restriction_reason"}
                    self.coordinator.block(ticket, reason)
                    return 200, {"blocked": True}
                digest = self.coordinator.receive(ticket, request["artifact"], request.get("cleanupConfirmed"))
                return 200, {"artifactHash": digest, "publication": "pending"}
            # Only central publisher can acknowledge a proven operating commit.
            if action == "finish_without_publication":
                self.coordinator.finish_without_publication(request["ticket"], request["artifactHash"])
                return 200, {"publication": "not_required"}
            if action != "acknowledge_publication":
                return 403, {"error": "publisher_action_forbidden"}
            self.coordinator.acknowledge_publication(request["ticket"], request["artifactHash"], request["commitSha"])
            return 200, {"publication": "acknowledged"}
        except (ValueError, KeyError, TypeError, AttributeError):
            return 400, {"error": "invalid_request"}
        except RuntimeError:
            return 409, {"error": "state_conflict"}
