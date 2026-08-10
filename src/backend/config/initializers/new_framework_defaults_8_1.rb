# Rails 8.1 の新デフォルトに対する、このアプリでの判断を記録するファイル。
#
# config/application.rb は既に `config.load_defaults 8.1` なので、8.1 の既定値は全て
# 適用済みである。5 項目すべてを既定のまま採用したため、このファイルに実行される設定は無い。
# 次に `bin/rails app:update` を走らせる人が同じ調査をやり直さずに済むよう、
# 何を確認して採用したのかだけを残す。
#
# 判断: 2026-08-10 / 対象: Rails 8.0 → 8.1 アップグレード（Issue #117）
#
# * action_controller.escape_json_responses = false
#     JSON レスポンス中の `<` `>` `&` を \uXXXX へ逃がす処理が無効になる。
#     true へ戻す道は選ばない。Rails 8.1 は true という設定自体を非推奨とし 8.2 で無効に
#     すると予告しているため、戻しても猶予が延びるだけで判断を先送りするだけになる。
#     このアプリのフロントは JSON.parse するだけでレスポンスを HTML 文脈へ埋め込まない。
#     この前提は spec/requests/json_escaping_spec.rb に固定してある。
#     脅威モデル上も、付箋・テキスト・コメント本文の XSS（TM.md の T6）に対する防御は
#     「出力側でエスケープする」ことに置いており、React がテキストとして描画する時点で
#     成立している。JSON エンコード時のエスケープはその上に重ねた一枚であって主防御ではない。
#
# * active_support.escape_js_separators_in_json = false
#     U+2028 / U+2029 は JSON 文字列中で合法。JSONP も <script> への直接埋め込みも無い。
#
# * action_controller.action_on_path_relative_redirect = :raise
#     app/ 配下に redirect_to が存在しないため影響を受けない。
#
# * active_record.raise_on_missing_required_finder_order_columns = true
#     暗黙の並び順に頼る finder は無い。ObjectOp の取得は order を明示している。
#
# * action_view.render_tracker = :ruby / action_view.remove_hidden_field_autocomplete = true
#     ビューは管理画面の 2 テンプレートのみで、form_with もフラグメント依存も無い。
#
# * yjit
#     8.1 の `self.yjit = !Rails.env.local?` は本番の挙動を変えない。
#     8.0 が読み込む 7.2 の既定が既に `self.yjit = true`（railties の
#     rails/application/configuration.rb）で、本番では以前から YJIT が有効だったためである。
#     8.1 が変えるのは development と test を対象外にした点だけなので、そのまま採用する。
#     メモリ実測を根拠に本番で止めたくなった場合は、このファイルではなく
#     config/environments/production.rb に書くこと。このファイルは Rails の
#     アップグレードガイドが「新デフォルト採用後に削除してよい」と案内する場所であり、
#     消えても気付けない設定を置く場所ではない。
