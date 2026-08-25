require "rails_helper"

# セッションの有効期限は、フォロワー判定を委譲した後の降格の担保である（Issue #258）。
# 期限が無いとセッションが続く限りログイン処理が走らず、アンフォローしても使い続けられる。
RSpec.describe "セッションの有効期限" do
  let(:options) { Rails.application.config.session_options }

  it "有効期限が設定されている" do
    expect(options[:expire_after]).to be_present
  end

  it "既定は7日" do
    expect(options[:expire_after]).to eq(7.days)
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
  it "利用者ごとの最終確認日時を持たない" do
    columns = User.column_names

    expect(columns).not_to include("plan_checked_at", "last_decision_at", "manual_rechecked_at")
  end
end
