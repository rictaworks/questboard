require "spec_helper"
require_relative "../../lib/development_allowed_origins"

RSpec.describe DevelopmentAllowedOrigins do
  describe ".resolve" do
    it "always allows the plain localhost origin used outside Codespaces" do
      origins = described_class.resolve(codespace_name: nil, forwarding_domain: nil)

      expect(origins).to eq([ "http://localhost:3000" ])
    end

    it "ignores blank codespace name or forwarding domain" do
      expect(described_class.resolve(codespace_name: "", forwarding_domain: "app.github.dev"))
        .to eq([ "http://localhost:3000" ])
      expect(described_class.resolve(codespace_name: "curly-journey", forwarding_domain: ""))
        .to eq([ "http://localhost:3000" ])
    end

    it "adds a pattern that matches any forwarded port under the current codespace when both are set" do
      origins = described_class.resolve(codespace_name: "curly-journey-gxq7gpgxwwj73j6w", forwarding_domain: "app.github.dev")

      expect(origins.first).to eq("http://localhost:3000")
      pattern = origins.last

      expect(pattern).to be_a(Regexp)
      expect(pattern).to match("https://curly-journey-gxq7gpgxwwj73j6w-3100.app.github.dev")
      expect(pattern).to match("https://curly-journey-gxq7gpgxwwj73j6w-3001.app.github.dev")
    end

    it "does not match another codespace's forwarded origin" do
      origins = described_class.resolve(codespace_name: "curly-journey-gxq7gpgxwwj73j6w", forwarding_domain: "app.github.dev")
      pattern = origins.last

      expect(pattern).not_to match("https://someone-elses-codespace-3100.app.github.dev")
    end

    it "does not match a spoofed origin that merely embeds the codespace name" do
      origins = described_class.resolve(codespace_name: "curly-journey-gxq7gpgxwwj73j6w", forwarding_domain: "app.github.dev")
      pattern = origins.last

      expect(pattern).not_to match("https://curly-journey-gxq7gpgxwwj73j6w-3100.app.github.dev.evil-attacker.com")
      expect(pattern).not_to match("https://evil-attacker.com/curly-journey-gxq7gpgxwwj73j6w-3100.app.github.dev")
    end
  end

  describe ".allowed?" do
    it "matches the plain localhost origin regardless of codespace configuration" do
      expect(
        described_class.allowed?("http://localhost:3000", codespace_name: nil, forwarding_domain: nil)
      ).to be(true)
    end

    it "matches a forwarded origin under the configured codespace" do
      expect(
        described_class.allowed?(
          "https://curly-journey-gxq7gpgxwwj73j6w-3100.app.github.dev",
          codespace_name: "curly-journey-gxq7gpgxwwj73j6w",
          forwarding_domain: "app.github.dev"
        )
      ).to be(true)
    end

    it "rejects an origin outside both the localhost and codespace patterns" do
      expect(
        described_class.allowed?(
          "http://evil-attacker.com",
          codespace_name: "curly-journey-gxq7gpgxwwj73j6w",
          forwarding_domain: "app.github.dev"
        )
      ).to be(false)
    end
  end
end
