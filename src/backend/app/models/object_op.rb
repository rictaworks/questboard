class ObjectOp < ApplicationRecord
  self.table_name = "object_ops"

  belongs_to :board
  belongs_to :board_object, class_name: "BoardObject", foreign_key: :object_id, inverse_of: false
  belongs_to :user

  validates :property, presence: true
  validates :client_id, presence: true
  validates :lamport_ts, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  # SyncOpRelay が配信対象のIDを読むための名前。object_id そのものを契約に使わないこと。
  # object_id は Object に元から存在するため、ActiveRecord 以外のop（例:
  # QuestProgressService::RelayOp）で属性として定義しようとすると Ruby の警告が出るうえ、
  # 定義し忘れると method_missing が発火せず Ruby の内部オブジェクトIDが黙って配信される。
  # 実際にクエスト通知でこの取り違えが起きていた（PR #61）。
  def relay_object_id
    self[:object_id]
  end
end
