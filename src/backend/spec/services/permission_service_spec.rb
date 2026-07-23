require "rails_helper"

RSpec.describe PermissionService do
  subject(:service) { described_class.new }

  let(:actor_id) { 42 }
  let(:self_comment_state) do
    {
      actor_id:,
      comment_author_id: actor_id
    }
  end
  let(:unlocked_state) do
    self_comment_state.merge(locked: false)
  end
  let(:locked_by_self_state) do
    self_comment_state.merge(locked: true, lock_owner_id: actor_id)
  end
  let(:locked_by_other_state) do
    self_comment_state.merge(locked: true, lock_owner_id: 99)
  end

  describe "#authorize" do
    it "covers the 4-role × 10-action × 2-lock-state matrix" do
      matrix = {
        owner: {
          unlocked: %i[
            view_board
            view_comments
            create_object
            edit_object
            delete_object
            create_comment
            edit_comment
            delete_comment
            lock_frame
            unlock_frame
          ],
          locked_by_self: %i[
            view_board
            view_comments
            create_object
            edit_object
            delete_object
            create_comment
            edit_comment
            delete_comment
            lock_frame
            unlock_frame
          ]
        },
        editor: {
          unlocked: %i[
            view_board
            view_comments
            create_object
            edit_object
            delete_object
            create_comment
            edit_comment
            delete_comment
            lock_frame
          ],
          locked_by_self: %i[
            view_board
            view_comments
            create_object
            edit_object
            delete_object
            create_comment
            edit_comment
            delete_comment
            unlock_frame
          ]
        },
        commenter: {
          unlocked: %i[
            view_board
            view_comments
            create_comment
            edit_comment
            delete_comment
          ],
          locked_by_self: %i[
            view_board
            view_comments
            create_comment
            edit_comment
            delete_comment
          ]
        },
        viewer: {
          unlocked: %i[
            view_board
          ],
          locked_by_self: %i[
            view_board
          ]
        }
      }

      states = {
        unlocked: unlocked_state,
        locked_by_self: locked_by_self_state
      }
      actions = %i[
        view_board
        view_comments
        create_object
        edit_object
        delete_object
        create_comment
        edit_comment
        delete_comment
        lock_frame
        unlock_frame
      ]

      results = []

      matrix.each do |role, states_by_role|
        states_by_role.each do |state_name, allowed_actions|
          actions.each do |action|
            expected = allowed_actions.include?(action)
            actual = service.authorize(role, action, states.fetch(state_name))

            results << actual
            expect(actual).to eq(expected), "#{role} / #{action} / #{state_name}"
          end
        end
      end

      expect(results.count(true)).to eq(50)
    end

    it "allows board administration only for owner" do
      %i[delete_board change_role].each do |action|
        expect(service.authorize(:owner, action, unlocked_state)).to be(true)
        expect(service.authorize(:editor, action, unlocked_state)).to be(false)
        expect(service.authorize(:commenter, action, unlocked_state)).to be(false)
        expect(service.authorize(:viewer, action, unlocked_state)).to be(false)
      end
    end

    it "restricts locked-frame object edits to the lock holder or owner" do
      expect(service.authorize(:editor, :edit_object, locked_by_other_state)).to be(false)
      expect(service.authorize(:editor, :unlock_frame, locked_by_other_state)).to be(false)
      expect(service.authorize(:editor, :edit_object, locked_by_self_state)).to be(true)
      expect(service.authorize(:editor, :unlock_frame, locked_by_self_state)).to be(true)
      expect(service.authorize(:owner, :edit_object, locked_by_other_state)).to be(true)
      expect(service.authorize(:owner, :unlock_frame, locked_by_other_state)).to be(true)
    end

    it "allows commenters to mutate only their own comments" do
      other_comment_state = unlocked_state.merge(comment_author_id: 99)

      expect(service.authorize(:commenter, :create_comment, unlocked_state)).to be(true)
      expect(service.authorize(:commenter, :edit_comment, unlocked_state)).to be(true)
      expect(service.authorize(:commenter, :delete_comment, unlocked_state)).to be(true)
      expect(service.authorize(:commenter, :edit_comment, other_comment_state)).to be(false)
      expect(service.authorize(:commenter, :delete_comment, other_comment_state)).to be(false)
    end

    it "supports all 14 seeded radial menu item action codes for editors" do
      seeded_menu_actions = %i[
        create_sticky
        create_shape
        create_text
        create_frame
        duplicate
        delete
        lock
        unlock
        comment
        align
        group
        ungroup
        recolor
        share
      ]

      seeded_menu_actions.each do |action_code|
        state = (action_code == :unlock ? locked_by_self_state : unlocked_state)
        expect(service.authorize(:editor, action_code, state)).to be(true), "expected editor to be authorized for #{action_code}"
      end
    end

    it "denies unknown roles and actions by default" do
      expect(service.authorize(:superadmin, :view_board, unlocked_state)).to be(false)
      expect(service.authorize(:editor, :launch_missiles, unlocked_state)).to be(false)
      expect(service.authorize(nil, :view_board, unlocked_state)).to be(false)
      expect(service.authorize(:owner, nil, unlocked_state)).to be(false)
    end

    it "authorizes owner for any action name, including ones outside the known alias map" do
      # owner権限は「全アクション可」の仕様通り、アクション名の妥当性チェックより先に許可される。
      # action は常にアプリ内部のコードが渡す値でありユーザー入力ではないため、これは意図した挙動。
      expect(service.authorize(:owner, :some_future_action_not_yet_defined, unlocked_state)).to be(true)
    end
  end
end
