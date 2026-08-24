require "rails_helper"

RSpec.describe "follower_gate initializer" do
  let(:original_base_url) { ENV["X_FOLLOWER_GATE_BASE_URL"] }
  let(:original_client_id) { ENV["X_FOLLOWER_GATE_CLIENT_ID"] }
  let(:original_credential) { ENV["X_FOLLOWER_GATE_CREDENTIAL"] }

  def load_initializer
    load Rails.root.join("config/initializers/follower_gate.rb").to_s
  end

  before do
    ENV["X_FOLLOWER_GATE_BASE_URL"] = "https://follower-gate.test"
    ENV["X_FOLLOWER_GATE_CLIENT_ID"] = "questboard"
    ENV["X_FOLLOWER_GATE_CREDENTIAL"] = "test-credential"
  end

  after do
    ENV["X_FOLLOWER_GATE_BASE_URL"] = original_base_url
    ENV["X_FOLLOWER_GATE_CLIENT_ID"] = original_client_id
    ENV["X_FOLLOWER_GATE_CREDENTIAL"] = original_credential
    load_initializer
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
