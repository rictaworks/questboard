class AddUserIdIndexToBoardMembers < ActiveRecord::Migration[8.1]
  def change
    add_index :board_members, :user_id
  end
end
