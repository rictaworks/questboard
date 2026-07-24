class AddTextCrdtRevisionToObjects < ActiveRecord::Migration[8.0]
  def change
    # Persisting the revision on the object row itself (rather than computing
    # ObjectOp.where(...).maximum(:id) on every read) guarantees text_crdt and its revision
    # are always updated together in the same row-locked transaction — a read can never
    # observe an older body paired with a newer revision (or vice versa), which a
    # compute-on-read approach cannot guarantee against a concurrent writer (see PR #55
    # review). 0 means "no text_crdt history yet", matching transform_text_crdt_ops'
    # treatment of a nil/absent ref_revision.
    #
    # Deliberately just the column here — BackfillTextCrdtRevision (a separate, later
    # migration) does the actual data backfill for objects with pre-existing text_crdt
    # history. Splitting them means a process crash mid-backfill leaves only this trivial,
    # idempotent-on-rerun step's work at risk, never a partially-applied add_column (see PR
    # #55 review).
    #
    # === Deploy runbook: this migration requires a brief maintenance window ===
    # Deploy old-code-compatible cases (geometry/color/deleted_at ops, and any board/object
    # read) are unaffected — this column is additive and every other code path ignores it.
    # But between "this migration + BackfillTextCrdtRevision have run" and "the new
    # application code (which now requires ref_revision once history exists, and maintains
    # text_crdt_revision on every write) is actually serving requests", the OLD application
    # code is still live and does not know this column exists: it updates `text_crdt` and
    # `object_ops` but never `text_crdt_revision`. Any text_crdt edit an old-code instance
    # accepts during that window leaves text_crdt_revision stale relative to the real
    # history, and the next edit under the new code would silently re-apply already-merged
    # ops as if they were still pending OT, corrupting the document.
    #
    # To avoid this: stop traffic to (or otherwise ensure no text_crdt-editing requests
    # reach) the old application code before running this migration and
    # BackfillTextCrdtRevision, and only resume traffic once the new application code is
    # what's serving requests. A brief maintenance window is the simplest way to guarantee
    # this ordering; see WORK/ for the deploy record of when this was run.
    add_column :objects, :text_crdt_revision, :bigint, null: false, default: 0
  end
end
