namespace :board_objects do
  desc "30日を超えた tombstone を物理削除する（DRY_RUN=true で件数のみ表示）"
  task purge_tombstones: :environment do
    dry_run = ENV["DRY_RUN"] == "true"
    result = BoardObjects::TombstonePurger.new.call(dry_run:)

    message = "[purge_tombstones] #{dry_run ? 'dry-run ' : ''}#{result}"
    Rails.logger.info(message)
    puts message
  end
end
