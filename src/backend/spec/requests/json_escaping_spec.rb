require "rails_helper"

# Rails 8.1 の新デフォルト `action_controller.escape_json_responses = false` により、
# JSON レスポンス中の `<` `>` `&` は \uXXXX へ逃がされなくなった（8.0 までは逃がしていた）。
#
# 8.0 までの挙動へ戻す道は選べない。Rails 8.1 は `escape_json_responses = true` という
# 設定自体を非推奨とし、8.2 では無効になると予告している
# （actionpack の action_controller/metal/renderers.rb: DeprecatedEscapeJsonResponses）。
# 戻しても猶予が延びるだけで、いずれ同じ判断を迫られる。
#
# したがって 8.1 の既定をそのまま採る。そのかわり「JSON レスポンスは HTML エスケープ
# されていない」という前提をここに固定しておく。この API のレスポンスを HTML 文脈へ
# 直接埋め込む実装（ERB への差し込み、innerHTML への代入など）を足すときは、
# 埋め込む側でエスケープすること。フレームワーク側の保険はもう無い。
RSpec.describe "JSON レスポンスの HTML エスケープ方針", type: :request do
  let(:session_creator) { instance_double(Auth::XSessionCreator) }
  let!(:member_plan) { Plan.find_or_create_by!(code: "member") }
  let(:owner) { User.create!(x_user_id: "x-sub-owner", display_name: "Owner User", plan: member_plan) }

  before do
    allow(Auth::XSessionCreator).to receive(:new).and_return(session_creator)
    seed_roles
  end

  def seed_roles
    Role.upsert_all(
      [
        { code: "owner" },
        { code: "editor" },
        { code: "commenter" },
        { code: "viewer" }
      ],
      unique_by: :index_roles_on_code
    )
  end

  def sign_in(user)
    allow(session_creator).to receive(:call).and_return(user)

    post "/auth/x_sessions", params: {
      code: "authorization-code",
      code_verifier: "pkce-verifier",
      recaptcha_token: "recaptcha-token"
    }, as: :json

    expect(response).to have_http_status(:created)
  end

  it "HTML 特殊文字をエスケープせずそのまま返す（Rails 8.1 の既定を採用している）" do
    sign_in(owner)
    title = "<script>x=1</script> & more"

    post "/boards", params: { title: }, as: :json

    expect(response).to have_http_status(:created)

    # 生のレスポンスボディを見る。JSON.parse した後では両者を区別できない。
    expect(response.body).to include(title)
    expect(response.body).not_to include("\\u003c")
    expect(response.body).not_to include("\\u0026")
  end

  it "エスケープの有無にかかわらず、復号した値は入力どおりである" do
    sign_in(owner)
    title = "<script>x=1</script> & more"

    post "/boards", params: { title: }, as: :json

    expect(response).to have_http_status(:created)
    expect(JSON.parse(response.body).fetch("board").fetch("title")).to eq(title)
  end
end
