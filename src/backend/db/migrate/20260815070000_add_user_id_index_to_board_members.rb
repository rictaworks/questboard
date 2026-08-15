class AddUserIdIndexToBoardMembers < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def change
    add_index :board_members, :user_id, algorithm: :concurrently
  end
end
