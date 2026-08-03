class Board < ApplicationRecord
  has_secure_token :share_token

  scope :active, -> { where(deleted_at: nil) }

  has_many :board_members, dependent: :destroy
  has_many :users, through: :board_members
  has_many :board_objects, class_name: "BoardObject", foreign_key: :board_id
  has_many :object_ops, foreign_key: :board_id, inverse_of: :board
  has_many :comments, -> { where(objects: { deleted_at: nil }) }, through: :board_objects

  validates :title, presence: true

  # このボードで記録済みの Lamport 論理時刻の最大値。クライアントはボード取得時に
  # 自分のカウンタをこの値まで進めてから編集を送る。0 から再開すると、op 履歴のある
  # プロパティに対する最初の N 回の編集が LWW 判定で StaleOpError になり、
  # ユーザーには「操作が巻き戻る」ようにしか見えない（Issue #86）。
  def latest_lamport_ts
    object_ops.maximum(:lamport_ts) || 0
  end

  def self.create_with_owner!(title:, owner:)
    transaction do
      board = create!(title:)
      board.board_members.create!(user: owner, role: Role.owner)
      board
    end
  end

  def join_member!(user:, role_code:)
    role = Role.find_by!(code: role_code.to_s)

    board_members.create_or_find_by!(user:) do |member|
      member.role = role
    end
  end

  def member_for!(user)
    board_members.includes(:role).find_by!(user:)
  end

  def tombstone!
    deleted_at_time = deleted_at || Time.current

    transaction do
      update!(deleted_at: deleted_at_time)
      board_members.destroy_all
      board_objects.active.update_all(deleted_at: deleted_at_time)
    end

    deleted_at_time
  end
end
