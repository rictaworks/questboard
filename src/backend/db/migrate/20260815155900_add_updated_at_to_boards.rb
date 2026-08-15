class AddUpdatedAtToBoards < ActiveRecord::Migration[8.1]
  def up
    add_column :boards, :updated_at, :datetime
    execute "UPDATE boards SET updated_at = created_at WHERE updated_at IS NULL"
    change_column_null :boards, :updated_at, false
  end

  def down
    remove_column :boards, :updated_at
  end
end
