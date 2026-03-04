import { describe, it, expect } from "vitest";
import { SchemeNetworkServer } from "../../src/exact/server/scheme";
import {
  TON_MAINNET,
  USDT_MAINNET_MASTER,
} from "../../src/constants";
import type { TonFee } from "../../src/types";

describe("SchemeNetworkServer", () => {
  const facilitatorAddress =
    "0:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

  const fee: TonFee = {
    percentage: 0.02,
    minimum: "10000",
    address: facilitatorAddress,
  };

  const server = new SchemeNetworkServer(TON_MAINNET, facilitatorAddress, fee);

  describe("scheme", () => {
    it('is "exact"', () => {
      expect(server.scheme).toBe("exact");
    });
  });

  describe("parsePrice", () => {
    it("parses USDT $1.00 correctly", () => {
      const result = server.parsePrice("1.00", USDT_MAINNET_MASTER);
      expect(result.asset).toBe(USDT_MAINNET_MASTER);
      expect(result.amount).toBe("1000000");
    });

    it("parses native TON 0.5 correctly", () => {
      const result = server.parsePrice("0.5", "native");
      expect(result.asset).toBe("native");
      expect(result.amount).toBe("500000000");
    });

    it("throws for unsupported asset", () => {
      expect(() => server.parsePrice("1.00", "unknown-asset")).toThrow(
        "Unsupported asset",
      );
    });

    it("throws for unsupported network", () => {
      const badServer = new SchemeNetworkServer(
        "tvm:-999",
        facilitatorAddress,
        fee,
      );
      expect(() => badServer.parsePrice("1.00", "native")).toThrow(
        "Unsupported network",
      );
    });
  });

  describe("enhancePaymentRequirements", () => {
    it("adds extra field with facilitator address and fee", () => {
      const requirements = {
        scheme: "exact",
        network: TON_MAINNET,
        asset: "native",
        amount: "1000000000",
        payTo: "0:aaaa",
      };

      const enhanced = server.enhancePaymentRequirements(requirements);

      expect(enhanced.extra).toBeDefined();
      const extra = enhanced.extra as {
        facilitatorAddress: string;
        fee: TonFee;
      };
      expect(extra.facilitatorAddress).toBe(facilitatorAddress);
      expect(extra.fee.percentage).toBe(0.02);
      expect(extra.fee.minimum).toBe("10000");
      expect(extra.fee.address).toBe(facilitatorAddress);
    });

    it("preserves original requirement fields", () => {
      const requirements = {
        scheme: "exact",
        network: TON_MAINNET,
        asset: "native",
        amount: "1000000000",
        payTo: "0:aaaa",
      };

      const enhanced = server.enhancePaymentRequirements(requirements);
      expect(enhanced.scheme).toBe("exact");
      expect(enhanced.network).toBe(TON_MAINNET);
      expect(enhanced.asset).toBe("native");
      expect(enhanced.amount).toBe("1000000000");
      expect(enhanced.payTo).toBe("0:aaaa");
    });
  });
});
