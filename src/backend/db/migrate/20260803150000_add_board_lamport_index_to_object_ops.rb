class AddBoardLamportIndexToObjectOps < ActiveRecord::Migration[8.0]
  # ボード単位の最大 lamport_ts を求めるクエリ（BoardsController#serialize_canvas_board の
  # lamportTs と ObjectsController の跳躍ガードのベースライン）が
  # index_object_ops_on_board_id ではソートを伴うため、lamport_ts を複合キーに含めて
  # インデックスの末尾だけを読めるようにする。
  def change
    add_index :object_ops, [ :board_id, :lamport_ts ]
  end
end
