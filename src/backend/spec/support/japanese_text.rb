# 「日本語が含まれるか」の判定を検査どうしで共有する。
#
# 同じ名前の判定を spec ごとに書くと、片方だけ範囲を広げたときにもう片方が追随せず、
# 同じ文字列が一方では違反・他方では正常という食い違いが起きる。
#
# ひらがな・カタカナ・漢字の範囲指定だけでは、長音符「ー」(U+30FC)・繰り返し符号
# 「々」(U+3005)・全角記号・半角カタカナ・拡張漢字（CJK 拡張 A 以降）を取りこぼす。
module JapaneseText
  PATTERN = /[\p{Hiragana}\p{Katakana}\p{Han}\p{-Uideo}ー々〆〜｜、。「」『』・！？]/

  module_function

  def japanese?(text)
    text.match?(PATTERN)
  end
end
