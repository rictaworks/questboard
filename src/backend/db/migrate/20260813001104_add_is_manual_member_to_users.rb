class AddIsManualMemberToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :is_manual_member, :boolean, default: false, null: false
  end
end
