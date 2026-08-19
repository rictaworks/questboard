class AddShapeKindToObjects < ActiveRecord::Migration[8.1]
  # 図形オブジェクトの形状（issue #200）。NULL は従来どおりの四角（rectangle）として
  # 扱うため、既存行のバックフィルは不要。shape 以外の object_type では常に NULL。
  def change
    add_column :objects, :shape_kind, :string
  end
end
