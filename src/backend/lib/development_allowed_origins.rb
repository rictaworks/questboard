module DevelopmentAllowedOrigins
  module_function

  # 本番はVercelの固定ドメインを CORS_ALLOWED_ORIGINS で明示するだけでよいが、
  # 開発はCodespaces上で動く。コンテナ内から直接見るとき用の http://localhost:3000
  # に加えて、開発者が実ブラウザでCodespacesの転送URL
  # （<codespace-name>-<port>.<forwarding-domain>）越しに開いた場合もオリジンを
  # 許可する必要がある。フロント側の動的backend URL解決
  # （questboard/src/lib/backend-url.ts）と対になる、バックエンド側の分岐。
  #
  # CODESPACE_NAME はCodespaces自身が設定する環境変数。CODESPACES_FORWARDING_DOMAIN
  # は .env で明示する（本番の .env には設定しないこと）。どちらかが未設定なら
  # 従来どおり localhost のみを許可する。
  #
  # 現在のcodespace名に完全一致するホストのみを許可する正規表現を返す
  # （他人のcodespaceや、codespace名を埋め込んだだけの偽装オリジンにはマッチしない）。
  LOCALHOST_ORIGIN = "http://localhost:3000"

  def resolve(codespace_name: ENV["CODESPACE_NAME"], forwarding_domain: ENV["CODESPACES_FORWARDING_DOMAIN"])
    origins = [ LOCALHOST_ORIGIN ]

    return origins if codespace_name.to_s.strip.empty? || forwarding_domain.to_s.strip.empty?

    origins << %r{\Ahttps://#{Regexp.escape(codespace_name)}-\d+\.#{Regexp.escape(forwarding_domain)}\z}
    origins
  end

  # RequestOriginGuard（リクエストごとに評価）と Rack::Cors（本来は起動時に一度だけ
  # 評価される）の両方から呼べる、文字列・正規表現混在の一覧に対する一致判定。
  # Rack::Cors 側はテストでのENV差し替えを反映できるよう、起動時に配列を固定するのでは
  # なく、この関数をProcとして毎リクエスト呼び出す形にしている（config/initializers/cors.rb）。
  def allowed?(origin, codespace_name: ENV["CODESPACE_NAME"], forwarding_domain: ENV["CODESPACES_FORWARDING_DOMAIN"])
    resolve(codespace_name:, forwarding_domain:).any? do |allowed_origin|
      allowed_origin.is_a?(Regexp) ? allowed_origin.match?(origin) : allowed_origin == origin
    end
  end
end
