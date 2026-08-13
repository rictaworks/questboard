class AddManualRecheckedAtToUsers < ActiveRecord::Migration[8.0]
  def change
    add_column :users, :manual_rechecked_at, :datetime
  end
end
