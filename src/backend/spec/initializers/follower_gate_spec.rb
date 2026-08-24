require "rails_helper"

RSpec.describe "follower_gate initializer" do
  KEYS = %w[X_FOLLOWER_GATE_BASE_URL X_FOLLOWER_GATE_CLIENT_ID X_FOLLOWER_GATE_CREDENTIAL].freeze

  def load_initializer
    load Rails.root.join("config/initializers/follower_gate.rb").to_s
  end

  # 例の中で環境変数を壊すため、元の値は before より先に控える必要がある。
  # after で控えると、壊した後の値を「元の値」として書き戻してしまう。
  around do |example|
    originals = KEYS.to_h { |key| [ key, ENV[key] ] }

    example.run
  ensure
    originals.each { |key, value| ENV[key] = value }
    load_initializer
  end

  before do
    ENV["X_FOLLOWER_GATE_BASE_URL"] = "https://follower-gate.test"
    ENV["X_FOLLOWER_GATE_CLIENT_ID"] = "questboard"
    ENV["X_FOLLOWER_GATE_CREDENTIAL"] = "test-credential"
  end

  it "reads the connection settings" do
    load_initializer

    expect(Rails.configuration.x.follower_gate_base_url).to eq("https://follower-gate.test")
    expect(Rails.configuration.x.follower_gate_client_id).to eq("questboard")
  end

  # 未設定のまま既定値で動かすと、資格情報が無いことに気づかないまま公開され、
  # 内部APIの認証がすべて失敗する。起動時に落として気づけるようにする。
  it "raises when the base url is missing" do
    ENV["X_FOLLOWER_GATE_BASE_URL"] = nil

    expect { load_initializer }.to raise_error(StandardError, /X_FOLLOWER_GATE_BASE_URL/)
  end

  it "raises when the client id is missing" do
    ENV["X_FOLLOWER_GATE_CLIENT_ID"] = nil

    expect { load_initializer }.to raise_error(StandardError, /X_FOLLOWER_GATE_CLIENT_ID/)
  end

  it "raises when the credential is missing" do
    ENV["X_FOLLOWER_GATE_CREDENTIAL"] = nil

    expect { load_initializer }.to raise_error(StandardError, /X_FOLLOWER_GATE_CREDENTIAL/)
  end

  it "rejects a base url that is not an http(s) url" do
    ENV["X_FOLLOWER_GATE_BASE_URL"] = "follower-gate.test"

    expect { load_initializer }.to raise_error(StandardError, /X_FOLLOWER_GATE_BASE_URL/)
  end

  # 資格情報を平文で載せるため、本番では暗号化された経路のみを許可する。
  it "rejects a plain http base url in production" do
    ENV["X_FOLLOWER_GATE_BASE_URL"] = "http://follower-gate.test"
    allow(Rails).to receive(:env).and_return(ActiveSupport::StringInquirer.new("production"))

    expect { load_initializer }.to raise_error(StandardError, /https/)
  end
end
