class AddTimestampsToUserQuests < ActiveRecord::Migration[8.0]
  def change
    add_column :user_quests, :achieved_at, :datetime
    add_column :user_quests, :completed_at, :datetime
    add_column :user_quests, :reward_granted_at, :datetime
    add_column :user_quests, :skipped_at, :datetime
  end
end
