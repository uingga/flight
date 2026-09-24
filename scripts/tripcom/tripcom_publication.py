"""Central merge preparation; no Git, network, credential, or Naver calls."""
import copy
import hashlib
import json
from tripcom_flight_contract import to_flight


def prepare_publication(previous_cache, artifact):
    if artifact.get("publication") != "not_submitted" or artifact.get("naverQueries") != 0:
        raise ValueError("invalid_worker_authority")
    if artifact.get("status") not in ("collected", "collected_with_unknown", "blocked", "inconclusive"):
        raise ValueError("invalid_collection_status")
    if not artifact.get("runId") or artifact.get("host") not in ("B", "C"):
        raise ValueError("invalid_artifact_identity")
    if artifact["status"] == "inconclusive":
        observations = artifact.get("observations")
        expected = artifact.get("expectedCities")
        attempted = artifact.get("attemptedCities")
        if (artifact.get("stopReason") != "repeated_outbound_cards_timeout"
                or not isinstance(observations, list)
                or not isinstance(expected, int) or not 3 <= expected <= 40
                or not isinstance(attempted, int) or not 3 <= attempted <= expected
                or len(observations) < 3 or len(observations) > attempted
                or any(not isinstance(item, dict)
                    or item.get("status") != "collector_error"
                    or item.get("reason") != "stage_timeout"
                    or item.get("stage") != "outbound_cards_wait"
                    for item in observations[-3:])):
            raise ValueError("invalid_inconclusive_stop_evidence")
    # Re-convert observations centrally; never trust worker-supplied flights.
    verified, rejected = [], []
    for observation in artifact.get("observations", []):
        try:
            verified.append(to_flight(observation))
        except (ValueError, KeyError, TypeError):
            rejected.append(observation.get("city_code"))
    cities = [flight["arrival"]["city"] for flight in verified]
    if len(cities) != len(set(cities)) or len(cities) > 40:
        raise ValueError("one_flight_per_city_required")
    if artifact["status"] == "blocked":
        verified, cities = [], []  # Do not publish quotes from a restricted run.
    next_cache = copy.deepcopy(previous_cache)
    previous = previous_cache["flights"]
    if not isinstance(previous, list):
        raise ValueError("invalid_previous_cache")
    previous_by_id = {flight.get("id"): flight for flight in previous if flight.get("source") == "tripcom"}
    for flight in verified:
        old = previous_by_id.get(flight["id"], {})
        # Naver comparisons belong to the same itinerary, not the agency fare.
        # A price refresh must not erase them or fabricate a new checked time.
        for key in ("naverLowest", "naverCheckedAt", "firstSeen"):
            if key in old:
                flight[key] = copy.deepcopy(old[key])
    # Replace only cities with a valid new quote; an unconfirmed city must not
    # silently erase its previous flight. Existing visibility expiry still applies.
    next_cache["flights"] = [flight for flight in previous
        if flight.get("source") != "tripcom" or flight.get("arrival", {}).get("city") not in cities] + verified
    next_cache["tripcomPrimary"] = {
        "runId": artifact["runId"], "host": artifact["host"],
        "status": "blocked_preserved" if artifact["status"] == "blocked" else "partial" if rejected or artifact["status"] in ("collected_with_unknown", "inconclusive") else "collected",
        "verifiedCities": len(verified),
        "unconfirmedCities": max(len(rejected), artifact["expectedCities"] - len(verified)) if artifact["status"] == "inconclusive" else len(rejected),
        "publication": "pending",  # common writer must confirm separately
    }
    if verified:
        next_cache.setdefault("sourceUpdatedAt", {})["tripcom"] = max(flight["priceCheckedAt"] for flight in verified)
    next_cache["count"] = len(next_cache["flights"])
    next_cache.setdefault("sources", {})["tripcom"] = sum(f.get("source") == "tripcom" for f in next_cache["flights"])
    raw = json.dumps(artifact, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    request_id = hashlib.sha256(raw.encode()).hexdigest()
    return {"requestId": request_id, "cache": next_cache, "verifiedCount": len(verified)}
