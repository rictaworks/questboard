class EffectMaster < ApplicationRecord
  has_many :event_defs, foreign_key: :effect_id
end
