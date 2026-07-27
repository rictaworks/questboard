require "spec_helper"
require_relative "../../lib/sentry_event_sanitizer"

RSpec.describe SentryEventSanitizer do
  it "redacts board share tokens from request urls, breadcrumb urls, and transactions" do
    request = Struct.new(:url).new("https://app.example.test/ja/boards/share-token-123?auth=true#frag")
    breadcrumb_data = Struct.new(:url).new("https://app.example.test/b/share-token-456?token=secret")
    breadcrumb = Struct.new(:data, :message).new(breadcrumb_data, "/ja/b/share-token-789")
    event = Struct.new(:request, :breadcrumbs, :transaction).new(request, [breadcrumb], "/ja/b/share-token-999")

    described_class.sanitize!(event)

    expect(event.request.url).to eq("https://app.example.test/ja/boards/[redacted]")
    expect(event.breadcrumbs.first.data.url).to eq("https://app.example.test/b/[redacted]")
    expect(event.breadcrumbs.first.message).to eq("/ja/b/[redacted]")
    expect(event.transaction).to eq("/ja/b/[redacted]")
  end
end
