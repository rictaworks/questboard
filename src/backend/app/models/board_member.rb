class BoardMember < ApplicationRecord
  belongs_to :board
  belongs_to :user
  belongs_to :role

  # 一意性は index_board_members_on_board_id_and_user_id (DBレベルのユニーク制約) が担保する。
  # Railsレベルの uniqueness バリデーションは追加しない: Board#join_member! は
  # create_or_find_by! で競合を吸収する設計のため、事前SELECTで先に RecordInvalid を
  # 送出するバリデーションがあると、通常の再参加でも create_or_find_by! の
  # RecordNotUnique 救済ルートに到達できなくなる。
end
