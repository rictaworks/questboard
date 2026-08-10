# Rails 8.1 の新デフォルトに対する、このアプリでの判断を記録するファイル。
#
# config/application.rb は既に `config.load_defaults 8.1` なので、8.1 の既定値は全て
# 適用済みである。ここは「既定のまま受け入れた項目」と「意図して 8.0 までの値に戻した項目」を
# 残す場所であり、次に `bin/rails app:update` を走らせる人が同じ調査をやり直さずに済むようにする。
#
# 判断: 2026-08-10 / 対象: Rails 8.0 → 8.1 アップグレード（Issue #117）
#
# ── 既定のまま採用した項目（下で上書きしていないもの）──
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
# ── 既定を採らず、8.0 までの値に固定した項目 ──

# Rails 8.1 は本番環境で YJIT を既定で有効にする（load_defaults 8.1 が
# `self.yjit = !Rails.env.local?` を設定する）。YJIT は実行速度と引き換えに
# メモリを追加で確保するが、このバックエンドのデプロイ先は無料プランで、
# メモリ上限に対する実測値がまだ無い。OOM は全ユーザーの障害に直結するため、
# 実測できるまでは 8.0 までと同じく無効にしておく。
# 有効化するときは、この行を消すのではなく true にして、実測値を PR に添えること。
Rails.application.config.yjit = false
