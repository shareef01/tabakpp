# Historical integrity and history access

New day and manual-log snapshots capture the effective price when written. Historical edits use frozen inputs and preserve baseline credit in lifetime totals. Unchanged legacy edits are no-ops; changed records with unknown historical prices reject explicitly rather than substituting today's settings.

Both clients show closed dated records alongside legacy/manual logs and page both ledgers. Log cursors include date and document ID, even after deleting the cursor document. Cached edits refresh and live-window evictions are retained. Complete exports read the correct `date` field, preserve zero/null/classification metadata, and leave unknown historical economics empty in CSV.

The supported writer capacity is eight tracker snapshots. Configuration creation checks collection size on the client; concurrent additions can race, but rules enforce the eight-snapshot limit on dated writes. Rules validate counter deltas using document diffs rather than trusting the tracker ID hint. Existing day count and economic bounds remain validated. Manual-log snapshots are bounded owner-supplied metadata frozen on update, with inner economics validated by domain writers. Like existing owner-supplied aggregate credit, they are not anti-cheat evidence.

Legacy migration uses protocol 3 while retaining schema version 2. A unique fenced claim captures the global price and applies each tracker with permanent completion markers. Closed/full/overflow targets recover as visible logs with unknown historical money and known smoking-unit credit. Existing open-day snapshots remain unchanged. Transaction retries reset callback state. Cleanup releases the profile fence and stamps completion atomically; rules reject old-client cleanup/folding while recovery is pending.

Deploy updated Firestore rules before releasing either client. New claim metadata and markers require these rules. This patch performs no production deployment or historical rewrite. iOS runtime validation is outside this work's scope.

Other medium audit findings remain follow-up work, including lifetime/today projections outside History, reconciliation starvation, App Check enforcement and release policy.
