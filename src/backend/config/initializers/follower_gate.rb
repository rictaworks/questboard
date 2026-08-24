# フォロワー判定サービス（x-follower-gate）への接続設定（Issue #253）。
#
# **判定サービスのベースURLをリポジトリへ書かない。** 環境変数のみに置く
# （x-follower-gate requirements.md 12.3）。秘匿を認可の根拠にはしないが、
# 探索の対象になる面を減らす。
#
# **未設定のとき既定値へ倒さない。** 既定で動かすと、資格情報が設定されていないことに
# 気づかないまま公開され、内部APIの認証がすべて失敗する。
base_url = ENV["X_FOLLOWER_GATE_BASE_URL"].to_s.strip
client_id = ENV["X_FOLLOWER_GATE_CLIENT_ID"].to_s.strip
credential = ENV["X_FOLLOWER_GATE_CREDENTIAL"].to_s.strip

if base_url.empty?
  raise StandardError, "X_FOLLOWER_GATE_BASE_URL is required and must be non-empty."
end

if client_id.empty?
  raise StandardError, "X_FOLLOWER_GATE_CLIENT_ID is required and must be non-empty."
end

if credential.empty?
  raise StandardError, "X_FOLLOWER_GATE_CREDENTIAL is required and must be non-empty."
end

parsed_base_url = begin
  URI.parse(base_url)
rescue URI::InvalidURIError
  raise StandardError, "X_FOLLOWER_GATE_BASE_URL must be a valid URL."
end

unless parsed_base_url.is_a?(URI::HTTP) && parsed_base_url.host.present?
  raise StandardError, "X_FOLLOWER_GATE_BASE_URL must be an http(s) URL with a host."
end

# 資格情報を平文で載せるため、本番では暗号化された経路のみを許可する。
if Rails.env.production? && parsed_base_url.scheme != "https"
  raise StandardError, "X_FOLLOWER_GATE_BASE_URL must use https in production."
end

Rails.configuration.x.follower_gate_base_url = base_url
Rails.configuration.x.follower_gate_client_id = client_id
Rails.configuration.x.follower_gate_credential = credential
