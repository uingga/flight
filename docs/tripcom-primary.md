# Trip.com integration — staged, not enabled

## Fixed collection scope

- Existing Seoul / 40-city list, one cheapest calendar itinerary per city.
- B 06:17, 13:23, 20:30; C 10:12, 16:31 KST. No extra catch-up or other-host retry.
- Use the existing signed-in dedicated Chrome profile, never copy a personal profile.
- Verify outgoing and return cards, actual airports, adult roundtrip total including
  tax/issuance fees and payment condition. Calendar-only quotes are not publishable.
- Bank-account condition is retained and shown in detail only. No card-specific
  fare is silently relabeled as unrestricted. Unknown seats are not zero.

## Components

- `scripts/tripcom/tripcom_entry.py`: configuration-gated worker. No writer token.
- `tripcom_coordinator.py`: central SQLite ownership, fixed slots and shared circuit.
- `tripcom_transport.py`: loopback-only protocol for an authenticated SSH tunnel.
- `tripcom_worker.py`: acquire, collect, cleanup, submit; no publication acknowledgment.
- `scripts/publish-tripcom.mjs`: central publication adapter. Requires injected common
  broker, operational verifier and central acknowledgment; no standalone live command.
- `tripcom-writer-scope.mjs`: prevents another agency or unrelated metadata mutation.

## Naver / cache integration

Already-published, individually fresh Trip.com quotes join an already-approved Naver
run. There is no new run or budget increase and no wait for an unfinished Trip.com run.
Existing partial-city quotes are not rejuvenated by a different city's successful
refresh. General collection preserves Trip.com rows. A same-itinerary fare refresh
preserves existing Naver comparison evidence and its original check time.

## Deployment boundary

Do not overwrite the installed A/C runtime with this Git checkout wholesale: the
installed coordinator contains separate operational changes. Apply only reviewed
Trip.com changes through the current maintenance/deployment procedure, after idle
checks. Website code deployment still requires user deployment approval.

Not performed yet: scoped credentials/tunnels, central service registration and
publisher wiring, B/C installation/profile acceptance and installed hash checks.
Until these complete, the original B/C task remains unchanged. Do not claim a
successful website build means the new collector is active.

## Acceptance checklist

1. Review exact current runtime hashes and active collection/publication state.
2. Install central-only service and distinct B/C/publisher credentials securely;
   never grant B/C deployment authority or expose the loopback endpoint publicly.
3. Configure the existing SSH transport and pinned worker hostname/profile/state.
4. Verify authentication failure, cross-host exclusion, restart persistence and
   shared block with local fixtures, without travel-site requests.
5. Install workers while idle; preserve existing profiles and task times.
6. Verify common-writer and operating API readback before acknowledging publication.
7. Obtain specific live verification authority if another travel-site visit is needed.
8. Define and test completed-artifact retention before unattended enablement; do not
   delete active/uncertain records or clear locks as cleanup.

This document is a status/checklist, not authority to run additional collection.
