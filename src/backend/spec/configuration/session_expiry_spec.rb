require "rails_helper"

# セッションの有効期限は、フォロワー判定を委譲した後の降格の担保である（Issue #258）。
# 期限が無いとセッションが続く限りログイン処理が走らず、アンフォローしても使い続けられる。
RSpec.describe "セッションの有効期限" do
  let(:options) { Rails.application.config.session_options }

  it "有効期限が設定されている" do
    expect(options[:expire_after]).to be_present
  end

  # 環境変数が設定されていればその値が正しい。7日固定を期待すると、
  # 手元で期限を変えて動きを見たときに実装ではなくテストが赤くなる。
  # .env.example で 7 を配っているため、変更されうる前提で書く。
  it "環境変数で与えた日数と一致する" do
    expected_days = ENV.fetch("SESSION_EXPIRE_AFTER_DAYS", "7").to_i

    expect(options[:expire_after]).to eq(expected_days.days)
  end

  # 既定値そのものは実装側の定数として固定する。環境変数に依存しない。
  it "未設定のときの既定が7日である" do
    source = File.read(Rails.root.join("config/application.rb"))

    expect(source).to match(/ENV\.fetch\("SESSION_EXPIRE_AFTER_DAYS", "7"\)/)
  end

  # 値を config/application.rb へ直書きすると、運用で伸ばし縮めできない。
  it "値を環境変数から読む" do
    source = File.read(Rails.root.join("config/application.rb"))

    expect(source).to match(/ENV\.fetch\("SESSION_EXPIRE_AFTER_DAYS"/)
    expect(source).to match(/expire_after: session_expire_after_days\.to_i\.days/)
  end

  # 既定値へ倒すのは未設定のときだけ。壊れた値で起動させない。
  it "正の整数でない値を拒む" do
    source = File.read(Rails.root.join("config/application.rb"))

    expect(source).to match(/SESSION_EXPIRE_AFTER_DAYS must be a positive integer/)
  end

  # 降格の担保を2か所に置かない。どちらが効いて降格したのかが読めなくなる。
  #
  # 複数の引数を渡した include は「すべてを含む」を意味するため、その否定は
  # 「すべてが揃ったときだけ失敗」になる。1本だけ足された場合を取り逃がすので、
  # 積集合が空であることで確かめる。
  it "利用者ごとの最終確認日時を持たない" do
    forbidden = %w[plan_checked_at last_decision_at manual_rechecked_at]

    expect(User.column_names & forbidden).to be_empty
  end
end
