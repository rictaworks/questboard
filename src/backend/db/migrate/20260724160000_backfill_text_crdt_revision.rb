class BackfillTextCrdtRevision < ActiveRecord::Migration[8.0]
  disable_ddl_transaction!

  BACKFILL_BATCH_SIZE = 1000

  # Scoped, migration-local models so this migration keeps working after future changes to
  # ObjectOp/BoardObject (e.g. new validations/associations) — see Rails migration guides.
  class MigrationObjectOp < ActiveRecord::Base
    self.table_name = "object_ops"
  end

  class MigrationBoardObject < ActiveRecord::Base
    self.table_name = "objects"
  end

  def up
    # Any object edited before AddTextCrdtRevisionToObjects ran already has text_crdt
    # history in object_ops but would otherwise be stuck at revision 0 forever:
    # transform_text_crdt_ops treats 0 as "no history exists yet" and would instead see
    # real history, rejecting every future edit on that object as missing ref_revision with
    # no way for the client to ever recover a valid one (see PR #55 review). Backfill it to
    # the latest text_crdt ObjectOp#id.
    #
    # Batched by object_ops' own primary key (ascending) rather than one single UPDATE
    # across the whole objects table, so this stays safe to run against a large object_ops
    # table without a single long-held lock, a huge query result, or (thanks to
    # disable_ddl_transaction! above) one giant transaction spanning the entire backfill.
    # Batches are processed in strictly ascending id order, so when the same object_id
    # reappears in a later batch its (necessarily higher) local max simply overwrites the
    # previous assignment — the final value converges to each object's true global max.
    #
    # This migration does no DDL, only guarded UPDATEs (see backfill_object_revision!),
    # which makes it safe to simply rerun from the top after a crash or interrupted run —
    # every batch's UPDATE is idempotent (re-applying the same or a newer value is a no-op
    # or a correct forward move, never wrong), unlike AddTextCrdtRevisionToObjects' add_column
    # which cannot be safely retried once it has partially applied (see PR #55 review; this
    # is exactly why that column addition and this backfill are two separate migrations).
    #
    # The app may be live while this runs. Any text_crdt op it commits after our `maximum`
    # snapshot always gets a strictly higher id (ids are a monotonically increasing
    # sequence), and the app's own write path (ObjectsController#apply_mutation_for!)
    # unconditionally sets text_crdt_revision to that new op's id — always correct on its
    # own. The only race is this *migration's* write landing after that app write and
    # clobbering the newer, correct value back down to our older snapshot's max_id. Guarding
    # with `WHERE text_crdt_revision < max_id` makes that clobber impossible: if the app
    # already recorded a revision >= max_id, this UPDATE simply matches zero rows for that
    # object_id instead of overwriting it (see PR #55 review).
    #
    # This assumes the app writing during the backfill is already the NEW code (which
    # maintains text_crdt_revision on every write) — see AddTextCrdtRevisionToObjects for
    # the maintenance-window requirement that makes that assumption hold.
    MigrationObjectOp.where(property: "text_crdt").in_batches(of: BACKFILL_BATCH_SIZE) do |relation|
      relation.group(:object_id).maximum(:id).each do |object_id, max_id|
        backfill_object_revision!(object_id, max_id)
      end
    end
  end

  def down
    # Intentionally a no-op: reverting would mean resetting text_crdt_revision back to 0
    # for every object this backfilled, which is a destructive, blanket data change that
    # `down` should never do implicitly. AddTextCrdtRevisionToObjects#down (remove_column)
    # already reverses everything this migration wrote, since the whole column goes away
    # with it.
  end

  private

  def backfill_object_revision!(object_id, max_id)
    MigrationBoardObject.where(id: object_id)
                         .where("text_crdt_revision < ?", max_id)
                         .update_all(text_crdt_revision: max_id)
  end
end
