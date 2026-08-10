require "pathname"

# ソースを走査する検査（禁止シンボル・禁止リテラル等）が共通で使うパス解決。
#
# spec ファイルの位置からの相対パスでルートを決めると、spec を 1 階層移動しただけで
# 走査対象が空になり、検査が緑のまま空転する。Gemfile のある場所を遡って探す。
module BackendSourceTree
  module_function

  def root
    @root ||= begin
      found = Pathname.new(__dir__).ascend.find { |directory| directory.join("Gemfile").file? }
      raise "Gemfile が見つからず、バックエンドのルートを決められない" if found.nil?

      found
    end
  end

  # 指定ディレクトリ配下の .rb を集める。存在しないディレクトリを黙って飛ばすと
  # 走査対象が減ったことに気付けないため、そのまま空を返さず呼び出し側で
  # 「実際に読んでいるか」を検査すること。
  def ruby_paths(*directories)
    directories.flat_map { |directory| root.join(directory).glob("**/*.rb") }
  end

  def relative(path)
    path.relative_path_from(root)
  end
end
