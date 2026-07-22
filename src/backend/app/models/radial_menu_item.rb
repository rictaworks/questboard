class RadialMenuItem < ApplicationRecord
  scope :ordered, -> { order(:sort_order) }
end
