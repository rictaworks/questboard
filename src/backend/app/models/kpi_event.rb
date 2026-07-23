class KpiEvent < ApplicationRecord
  belongs_to :event_def
  belongs_to :user
  belongs_to :board
end
