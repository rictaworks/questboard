class EventDef < ApplicationRecord
  belongs_to :effect_master, foreign_key: :effect_id
end
