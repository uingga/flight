"""One candidate per city, durable execution, no publishing side effects."""
from pathlib import Path
from tripcom_state import RunState, atomic_json
from crawl_tripcom_40destinations import AccessRestricted
from tripcom_flight_contract import to_flight


class AdmissionLost(RuntimeError):
    pass


def execute_run(state_root, run_id, host, destinations, scan, now=None):
    keys = [dest["city_code"] for dest in destinations]
    if not 1 <= len(keys) <= 40:
        raise ValueError("destination_limit_exceeded")
    state = RunState(state_root, run_id, host, keys, now)
    with state.acquire():
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
                    "errorType": type(error).__name__, "publishable": False}
            state.finish_city(key, observation)
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
            "observations": observations, "flights": verified, "rejected": rejected,
            "publication": "not_submitted", "naverQueries": 0}
        atomic_json(Path(state_root) / "artifacts" / state.path.name, artifact)
        return artifact
