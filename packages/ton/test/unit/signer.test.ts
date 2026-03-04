import { describe, it, expect, beforeAll } from "vitest";
import { beginCell } from "@ton/core";
import { mnemonicNew, signVerify } from "@ton/crypto";
import { WalletContractV4, WalletContractV5R1 } from "@ton/ton";
import { ClientTonSigner, FacilitatorTonSigner } from "../../src/signer";

describe("ClientTonSigner", () => {
  let mnemonic: string[];
  let signer: ClientTonSigner;

  beforeAll(async () => {
    mnemonic = await mnemonicNew(24);
    signer = new ClientTonSigner(mnemonic);
    await signer.init();
  });

  it("getPublicKey returns 64-char hex string", () => {
    const pubKey = signer.getPublicKey();
    expect(pubKey).toHaveLength(64);
    expect(pubKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("getAddress returns raw format 0:<64hex>", () => {
    const address = signer.getAddress("v5r1");
    expect(address).toMatch(/^0:[0-9a-f]{64}$/);
  });

  it("getAddress works for v4r2 as well", () => {
    const address = signer.getAddress("v4r2");
    expect(address).toMatch(/^0:[0-9a-f]{64}$/);
  });

  it("getWalletContract returns WalletContractV4 for v4r2", () => {
    const contract = signer.getWalletContract("v4r2");
    expect(contract).toBeInstanceOf(WalletContractV4);
  });

  it("getWalletContract returns WalletContractV5R1 for v5r1", () => {
    const contract = signer.getWalletContract("v5r1");
    expect(contract).toBeInstanceOf(WalletContractV5R1);
  });

  it("sign produces a 64-byte signature", async () => {
    const cell = beginCell().storeUint(42, 32).endCell();
    const signature = await signer.sign(cell);
    expect(signature).toHaveLength(64);
  });

  it("sign + signVerify roundtrip works", async () => {
    const cell = beginCell().storeUint(123, 32).endCell();
    const signature = await signer.sign(cell);
    const publicKey = Buffer.from(signer.getPublicKey(), "hex");
    const isValid = signVerify(cell.hash(), signature, publicKey);
    expect(isValid).toBe(true);
  });

  it("throws error when not initialized", () => {
    const uninitSigner = new ClientTonSigner(mnemonic);
    expect(() => uninitSigner.getPublicKey()).toThrow(
      "Signer not initialized. Call init() first.",
    );
  });
});

describe("FacilitatorTonSigner", () => {
  let mnemonic: string[];
  let signer: FacilitatorTonSigner;

  beforeAll(async () => {
    mnemonic = await mnemonicNew(24);
    signer = new FacilitatorTonSigner(mnemonic);
    await signer.init();
  });

  it("getPublicKey returns 64-char hex string", () => {
    const pubKey = signer.getPublicKey();
    expect(pubKey).toHaveLength(64);
    expect(pubKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("getAddress returns raw format 0:<64hex>", () => {
    const address = signer.getAddress("v5r1");
    expect(address).toMatch(/^0:[0-9a-f]{64}$/);
  });

  it("getWalletContract returns WalletContractV4 for v4r2", () => {
    const contract = signer.getWalletContract("v4r2");
    expect(contract).toBeInstanceOf(WalletContractV4);
  });

  it("getWalletContract returns WalletContractV5R1 for v5r1", () => {
    const contract = signer.getWalletContract("v5r1");
    expect(contract).toBeInstanceOf(WalletContractV5R1);
  });

  it("sign produces a 64-byte signature", async () => {
    const cell = beginCell().storeUint(42, 32).endCell();
    const signature = await signer.sign(cell);
    expect(signature).toHaveLength(64);
  });

  it("sign + signVerify roundtrip works", async () => {
    const cell = beginCell().storeUint(456, 32).endCell();
    const signature = await signer.sign(cell);
    const publicKey = Buffer.from(signer.getPublicKey(), "hex");
    const isValid = signVerify(cell.hash(), signature, publicKey);
    expect(isValid).toBe(true);
  });

  it("throws error when not initialized", () => {
    const uninitSigner = new FacilitatorTonSigner(mnemonic);
    expect(() => uninitSigner.getPublicKey()).toThrow(
      "Signer not initialized. Call init() first.",
    );
  });
});
