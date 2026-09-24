"""One candidate per city, durable execution, no publishing side effects."""
from pathlib import Path
from tripcom_state import RunState, atomic_json
from crawl_tripcom_40destinations import AccessRestricted
from tripcom_flight_contract import to_flight
from tripcom_diagnostics import failure_details


class AdmissionLost(RuntimeError):
    pass


def execute_run(state_root, run_id, host, destinations, scan, now=None):
    keys = [dest["city_code"] for dest in destinations]
    if not 1 <= len(keys) <= 40:
        raise ValueError("destination_limit_exceeded")
    state = RunState(state_root, run_id, host, keys, now)
    with state.acquire():
        consecutive_missing_cards = 0
        for index, dest in enumerate(destinations, 1):
            key = dest["city_code"]
            if key not in state.pending():
                continue
            state.start_city(key)
            try:
                observation = scan(dest, index, len(destinations))
            except AdmissionLost:
                # Do not continue or classify central ownership loss as a city
                # error. Leave the durable inflight entry for reconciliation.
                raise
            except AccessRestricted as error:
                # Persist restriction before doing anything else. No next city,
                # no alternate host, no automatic same-run retry.
                state.block(str(error))
                break
            except Exception as error:
                observation = {"city_code": key, "status": "collector_error",
                    **failure_details(error), "publishable": False}
            state.finish_city(key, observation)
            missing_cards = (observation.get("status") == "collector_error"
                and observation.get("reason") == "stage_timeout"
                and observation.get("stage") == "outbound_cards_wait")
            consecutive_missing_cards = consecutive_missing_cards + 1 if missing_cards else 0
            if consecutive_missing_cards >= 3:
                # An HTTP 200 page without flight cards is not proof of an access
                # block. Stop this host's run without opening the shared circuit.
                state.stop_inconclusive("repeated_outbound_cards_timeout")
                break
        if state.document["status"] == "running":
            state.finish()
        observations = [entry["result"] for entry in state.document["entries"].values() if "result" in entry]
        verified, rejected = [], []
        for observation in observations:
            try:
                verified.append(to_flight(observation))
            except (ValueError, KeyError, TypeError) as error:
                rejected.append({"city_code": observation.get("city_code"), "reason": str(error)})
        # Isolated by immutable run identity; never overwrite legacy latest or
        # call the common writer while collecting.
        artifact = {"runId": run_id, "host": host, "status": state.document["status"],
            "expectedCities": len(keys), "attemptedCities": len(state.document["entries"]),
            "stopReason": state.document.get("stopReason"),
            "observations": observations, "flights": verified, "rejected": rejected,
            "publication": "not_submitted", "naverQueries": 0}
        atomic_json(Path(state_root) / "artifacts" / state.path.name, artifact)
        return artifact
