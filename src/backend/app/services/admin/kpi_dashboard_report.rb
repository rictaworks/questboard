# frozen_string_literal: true

require "set"

module Admin
  class KpiDashboardReport
    MATURITY_WINDOW_DAYS = 7
    EDITING_EVENT_CODES = %w[
      object_created_sticky
      object_created_shape
      object_created_text
      object_created_image
      object_created_frame
      object_deleted
      object_duplicated
      object_recolored
      object_locked
      object_unlocked
      comment_created
    ].freeze

    INTENSITY_LABELS = {
      "full" => "フル",
      "subtle" => "控えめ",
      "off" => "オフ"
    }.freeze

    def initialize(now: Time.current)
      @now = now
    end

    def call
      {
        d1_retention_rate: retention_rate(days: 1),
        d7_retention_rate: retention_rate(days: 7),
        concurrent_editors_per_board: concurrent_editors_per_board,
        radial_menu_reach_rate: radial_menu_reach_rate,
        quest_completion_rate: quest_completion_rate,
        intensity_distribution: intensity_distribution,
        intensity_total: intensity_total
      }
    end

    private

    attr_reader :now

    def retention_rate(days:)
      cohort = matured_user_event_dates
      return 0.0 if cohort.empty?

      retained = cohort.count { |first_date, dates| dates.include?(first_date + days) }
      percentage(retained, cohort.size)
    end

    def matured_user_event_dates
      @matured_user_event_dates ||= begin
        maturity_cutoff = now.to_date - MATURITY_WINDOW_DAYS

        user_event_dates.values.filter_map do |dates|
          unique_dates = dates.uniq.sort
          next if unique_dates.empty?

          first_date = unique_dates.first
          next if first_date > maturity_cutoff

          [ first_date, unique_dates ]
        end
      end
    end

    def user_event_dates
      @user_event_dates ||= begin
        dates_by_user = Hash.new { |hash, user_id| hash[user_id] = [] }

        KpiEvent.select(:id, :user_id, :occurred_at).find_each do |event|
          dates_by_user[event.user_id] << event.occurred_at.to_date
        end

        dates_by_user
      end
    end

    def concurrent_editors_per_board
      peak_editors_by_board = Hash.new(0)
      editors_by_board_and_bucket = Hash.new { |hash, board_id| hash[board_id] = Hash.new { |bucket_hash, bucket| bucket_hash[bucket] = Set.new } }

      editing_event_scope.select(:id, :board_id, :user_id, :occurred_at).find_each do |event|
        bucket = event.occurred_at.change(sec: 0, usec: 0)
        editors_by_board_and_bucket[event.board_id][bucket] << event.user_id
        peak_editors_by_board[event.board_id] = [ peak_editors_by_board[event.board_id], editors_by_board_and_bucket[event.board_id][bucket].size ].max
      end

      return 0.0 if peak_editors_by_board.empty?

      peak_editors_by_board.values.sum.to_f / peak_editors_by_board.size
    end

    def radial_menu_reach_rate
      percentage(distinct_user_count(kpi_event_scope.where(event_def_id: radial_event_def_ids)), active_user_count)
    end

    def quest_completion_rate
      percentage(UserQuest.where(state: "completed").count, UserQuest.count)
    end

    def intensity_distribution
      counts_by_intensity_id = UserSetting.group(:intensity_id).count

      IntensityMaster.order(:id).map do |intensity|
        count = counts_by_intensity_id[intensity.id].to_i

        {
          code: intensity.code,
          label: INTENSITY_LABELS.fetch(intensity.code, intensity.code),
          count: count,
          percentage: percentage(count, intensity_total)
        }
      end
    end

    def intensity_total
      @intensity_total ||= UserSetting.count
    end

    def active_user_count
      @active_user_count ||= distinct_user_count(kpi_event_scope)
    end

    def editing_event_scope
      @editing_event_scope ||= kpi_event_scope.where(event_def_id: editing_event_def_ids)
    end

    def kpi_event_scope
      KpiEvent.all
    end

    def editing_event_def_ids
      @editing_event_def_ids ||= EventDef.where(code: EDITING_EVENT_CODES).pluck(:id)
    end

    def radial_event_def_ids
      @radial_event_def_ids ||= EventDef.where(code: "radial_opened").pluck(:id)
    end

    def distinct_user_count(scope)
      scope.distinct.count(:user_id)
    end

    def percentage(numerator, denominator)
      return 0.0 if denominator.to_i.zero?

      (numerator.to_f / denominator.to_f) * 100.0
    end
  end
end
