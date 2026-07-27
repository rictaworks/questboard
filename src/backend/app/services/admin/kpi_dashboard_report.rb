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
      cutoff_date = now.to_date - MATURITY_WINDOW_DAYS

      sql = <<~SQL
        WITH user_first_dates AS (
          SELECT user_id, MIN(occurred_at::date) AS first_date
          FROM kpi_events
          GROUP BY user_id
        ),
        matured_users AS (
          SELECT user_id, first_date
          FROM user_first_dates
          WHERE first_date <= :cutoff_date
        ),
        retained_users AS (
          SELECT DISTINCT mu.user_id
          FROM matured_users mu
          JOIN kpi_events ke ON ke.user_id = mu.user_id AND ke.occurred_at::date = mu.first_date + :days
        )
        SELECT#{' '}
          (SELECT COUNT(*) FROM matured_users) AS cohort_size,
          (SELECT COUNT(*) FROM retained_users) AS retained_size
      SQL

      res = KpiEvent.connection.select_one(
        ActiveRecord::Base.sanitize_sql_array([ sql, cutoff_date: cutoff_date, days: days ])
      )

      cohort_size = res["cohort_size"].to_i
      retained_size = res["retained_size"].to_i

      return 0.0 if cohort_size.zero?
      percentage(retained_size, cohort_size)
    end

    def concurrent_editors_per_board
      event_ids = editing_event_def_ids
      return 0.0 if event_ids.empty?

      sql = <<~SQL
        WITH bucketed_editors AS (
          SELECT#{' '}
            board_id,
            date_trunc('minute', occurred_at) AS bucket,
            COUNT(DISTINCT user_id) AS editor_count
          FROM kpi_events
          WHERE event_def_id IN (:event_ids)
          GROUP BY board_id, date_trunc('minute', occurred_at)
        ),
        board_peaks AS (
          SELECT#{' '}
            board_id,
            MAX(editor_count) AS peak_count
          FROM bucketed_editors
          GROUP BY board_id
        )
        SELECT AVG(peak_count) AS avg_peak FROM board_peaks
      SQL

      res = KpiEvent.connection.select_one(
        ActiveRecord::Base.sanitize_sql_array([ sql, event_ids: event_ids ])
      )

      res["avg_peak"] ? res["avg_peak"].to_f : 0.0
    end

    def radial_menu_reach_rate
      percentage(distinct_user_count(kpi_event_scope.where(event_def_id: radial_event_def_ids)), active_user_count)
    end

    def quest_completion_rate
      event_def = EventDef.find_by(code: "quest_completed")
      return 0.0 unless event_def

      completed_count = kpi_event_scope.where(event_def_id: event_def.id).count
      total_possible = User.count * Quest.count
      return 0.0 if total_possible.zero?

      percentage(completed_count, total_possible)
    end

    def intensity_distribution
      counts = UserSetting.joins(:intensity_master).group("intensity_masters.code").count
      total = intensity_total

      IntensityMaster.order(:id).map do |intensity|
        count = counts[intensity.code].to_i

        {
          code: intensity.code,
          label: INTENSITY_LABELS.fetch(intensity.code, intensity.code),
          count: count,
          percentage: percentage(count, total)
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
