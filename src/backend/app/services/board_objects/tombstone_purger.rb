module BoardObjects
  # BoardObject::TOMBSTONE_RETENTION（30日）を超えた tombstone を物理削除する。
  #
  # 削除は不可逆なので、次の2点を守る。
  #
  # 1. 関連レコードを FK 安全な順で明示的に消す。objects を参照する外部キーは
  #    object_ops / comments / frame_locks の3つあるが、`dependent: :destroy` が
  #    付いているのは comments と frame_lock だけで、**object_ops には無い**。
  #    destroy 任せにすると object_ops が残って FK 違反で落ちる。
  # 2. まだ生きているオブジェクトから親フレームとして参照されている tombstone は
  #    消さずに残す。消すと FK 違反になるうえ、生存中オブジェクトの所属が壊れる。
  #
  # また delete_all を使い destroy を避けている。BoardObject は
  # `belongs_to :board, touch: true` を持つため、destroy すると 30 日前に消された
  # オブジェクトの後始末でボードの updated_at が更新され、「最終更新日時」順の
  # ボード一覧が保守バッチのたびに並び替わってしまう。
  class TombstonePurger
    DEFAULT_BATCH_SIZE = 500

    Result = Struct.new(:purged, :skipped, keyword_init: true) do
      def to_s
        "purged=#{purged} skipped=#{skipped}"
      end
    end

    def initialize(now: Time.current, batch_size: DEFAULT_BATCH_SIZE)
      @now = now
      @batch_size = batch_size
    end

    # dry_run: true のときは件数だけ数え、一切削除しない。
    def call(dry_run: false)
      purged = 0
      skipped = 0

      BoardObject.purgeable_tombstones(@now).in_batches(of: @batch_size) do |relation|
        ids = relation.pluck(:id)
        deletable = ids - referenced_parent_frame_ids(ids)
        skipped += ids.size - deletable.size

        next if deletable.empty?

        purged += deletable.size
        next if dry_run

        delete_objects(deletable)
      end

      Result.new(purged:, skipped:)
    end

    private

    # 削除対象の外にいるオブジェクトから親フレームとして参照されている ID。
    # 削除対象同士の参照は同一 DELETE 文で解消されるため除外しない。
    def referenced_parent_frame_ids(ids)
      BoardObject.where(parent_frame_id: ids).where.not(id: ids).distinct.pluck(:parent_frame_id)
    end

    def delete_objects(ids)
      BoardObject.transaction do
        ObjectOp.where(object_id: ids).delete_all
        Comment.where(object_id: ids).delete_all
        FrameLock.where(object_id: ids).delete_all
        BoardObject.where(id: ids).delete_all
      end
    end
  end
end
