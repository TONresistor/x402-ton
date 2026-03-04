import { describe, it, expect, beforeAll, vi } from "vitest";
import { Address } from "@ton/core";
import { mnemonicNew } from "@ton/crypto";
import { ClientTonSigner } from "../../src/signer";
import { TON_MAINNET, USDT_MAINNET_MASTER } from "../../src/constants";
import type { TonExtra } from "../../src/types";

// Mock TonClient to avoid real network calls
vi.mock("@ton/ton", async () => {
  const actual = await vi.importActual("@ton/ton");
  return {
    ...actual,
    TonClient: vi.fn().mockImplementation(() => ({
      open: vi.fn().mockReturnValue({
        getSeqno: vi.fn().mockResolvedValue(5),
      }),
      runMethod: vi.fn().mockResolvedValue({
        stack: {
          readAddress: vi.fn().mockReturnValue(
            Address.parse(
              "0:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
            ),
          ),
        },
      }),
    })),
  };
});

// Import SchemeNetworkClient after mock is set up
const { SchemeNetworkClient } = await import(
  "../../src/exact/client/scheme"
);

describe("SchemeNetworkClient", () => {
  let signer: ClientTonSigner;
  let client: InstanceType<typeof SchemeNetworkClient>;
  const facilitatorAddress =
    "0:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

  const extra: TonExtra = {
    facilitatorAddress,
    fee: {
      percentage: 0.02,
      minimum: "10000",
      address: facilitatorAddress,
    },
  };

  beforeAll(async () => {
    const mnemonic = await mnemonicNew(24);
    signer = new ClientTonSigner(mnemonic);
    await signer.init();
    client = new SchemeNetworkClient(signer, "v5r1");
  });

  it('scheme property is "exact"', () => {
    expect(client.scheme).toBe("exact");
  });

  it("createPaymentPayload for native TON returns valid ExactTonPayload", async () => {
    const payload = await client.createPaymentPayload(
      TON_MAINNET,
      "1000000000", // 1 TON in nanotons
      "native",
      facilitatorAddress,
      120,
      extra,
    );

    expect(payload).toBeDefined();
    expect(payload.boc).toBeTruthy();
    expect(payload.publicKey).toBeTruthy();
    expect(payload.walletVersion).toBe("v5r1");
  });

  it("createPaymentPayload for USDT returns valid ExactTonPayload", async () => {
    const payload = await client.createPaymentPayload(
      TON_MAINNET,
      "1000000", // 1 USDT
      USDT_MAINNET_MASTER,
      facilitatorAddress,
      120,
      extra,
    );

    expect(payload).toBeDefined();
    expect(payload.boc).toBeTruthy();
    expect(payload.publicKey).toBeTruthy();
    expect(payload.walletVersion).toBe("v5r1");
  });

  it("returned boc is valid base64", async () => {
    const payload = await client.createPaymentPayload(
      TON_MAINNET,
      "1000000000",
      "native",
      facilitatorAddress,
      120,
      extra,
    );

    // Should not throw when decoding base64
    const decoded = Buffer.from(payload.boc, "base64");
    expect(decoded.length).toBeGreaterThan(0);
  });

  it("returned publicKey matches signer", async () => {
    const payload = await client.createPaymentPayload(
      TON_MAINNET,
      "1000000000",
      "native",
      facilitatorAddress,
      120,
      extra,
    );

    expect(payload.publicKey).toBe(signer.getPublicKey());
  });

  it("returned walletVersion matches constructor arg", async () => {
    const clientV4 = new SchemeNetworkClient(signer, "v4r2");
    const payload = await clientV4.createPaymentPayload(
      TON_MAINNET,
      "1000000000",
      "native",
      facilitatorAddress,
      120,
      extra,
    );

    expect(payload.walletVersion).toBe("v4r2");
  });

  it("unsupported network throws error", async () => {
    await expect(
      client.createPaymentPayload(
        "tvm:-999",
        "1000000000",
        "native",
        facilitatorAddress,
        120,
        extra,
      ),
    ).rejects.toThrow("Unsupported network: tvm:-999");
  });
});
