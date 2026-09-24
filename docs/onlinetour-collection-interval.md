# OnlineTour five daily collection slots

OnlineTour uses all five general crawl slots at 06:17, 10:12, 13:23, 16:31 and
19:31 KST. The earlier randomized 2–3 day interval is disabled. The GitHub
general crawl and its watchdog expect the same five daily slots.

At each slot, A waits for that general crawl's published data before asking B
to collect OnlineTour. ModeTour and OnlineTour share Chrome and run serially.
A's task waits at most one hour for missing 19:31 upstream data.

Each OnlineTour slot has a distinct immutable B execution marker. A and B both
reject a duplicate attempt in the same slot. The existing PC lock, 24-hour
access circuit, explicit 401/403/429/CAPTCHA handling, maximum 100 product
requests, six regional navigations, complete coverage validation and zero
automatic retries remain. A failed or uncertain run does not turn into another
PC crawl of the same slot. The existing alternating GitHub fallback uses the
five OnlineTour slots and its own durable claim before any site request.

The admin history uses the same five-slot axis for general agencies so the
19:31 result is shown separately. An operator-approved manual collection is
still a separate one-shot path with a daily marker.

The previous 2–3 day interval remains in Git history for audit; it is no
longer the active collection gate.
