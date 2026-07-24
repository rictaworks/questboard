class AddPropertyIdIndexToObjectOps < ActiveRecord::Migration[8.0]
  def change
    # transform_text_crdt_ops filters by object_id+property and orders by the primary key
    # (id, used as the server-assigned monotonic OT history position) — this composite
    # index lets that query use an index-only scan instead of a sequential scan or a sort.
    add_index :object_ops, %i[object_id property id], name: "index_object_ops_on_object_id_and_property_and_id"
  end
end
