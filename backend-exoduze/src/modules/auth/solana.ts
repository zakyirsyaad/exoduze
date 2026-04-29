import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";

import { AuthError } from "./auth.service.js";

const textEncoder = new TextEncoder();

export function assertValidSolanaWalletAddress(walletAddress: string): string {
  const normalized = walletAddress.trim();

  if (!normalized) {
    throw new AuthError(400, "INVALID_WALLET_ADDRESS", "Wallet address is required.");
  }

  let publicKeyBytes: Uint8Array;

  try {
    publicKeyBytes = base58.decode(normalized);
  } catch {
    throw new AuthError(400, "INVALID_WALLET_ADDRESS", "Wallet address must be a valid Solana public key.");
  }

  if (publicKeyBytes.length !== 32) {
    throw new AuthError(400, "INVALID_WALLET_ADDRESS", "Wallet address must be a 32-byte Solana public key.");
  }

  return normalized;
}

export function buildSolanaAuthMessage({
  walletAddress,
  challengeId,
  nonce,
  expiresAt
}: {
  walletAddress: string;
  challengeId: string;
  nonce: string;
  expiresAt: string;
}) {
  const canonicalExpiresAt = new Date(expiresAt).toISOString();

  return [
    "Exoduze Sign-In",
    "",
    "Sign this message to authenticate with Exoduze.",
    `Wallet: ${walletAddress}`,
    `Challenge ID: ${challengeId}`,
    `Nonce: ${nonce}`,
    `Expires At: ${canonicalExpiresAt}`,
    "Chain: solana"
  ].join("\n");
}

export function verifySolanaSignedMessage({
  walletAddress,
  message,
  signature
}: {
  walletAddress: string;
  message: string;
  signature: string;
}) {
  const publicKey = base58.decode(assertValidSolanaWalletAddress(walletAddress));
  const signatureBytes = decodeSignature(signature);

  if (signatureBytes.length !== 64) {
    throw new AuthError(400, "INVALID_SIGNATURE", "Signature must decode to 64 bytes.");
  }

  return ed25519.verify(signatureBytes, textEncoder.encode(message), publicKey);
}

function decodeSignature(value: string): Uint8Array {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new AuthError(400, "INVALID_SIGNATURE", "Signature is required.");
  }

  try {
    return base58.decode(trimmed);
  } catch {
    // Try additional encodings below.
  }

  const hexCandidate = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (/^[0-9a-fA-F]+$/.test(hexCandidate) && hexCandidate.length % 2 === 0) {
    return Uint8Array.from(Buffer.from(hexCandidate, "hex"));
  }

  try {
    return Uint8Array.from(Buffer.from(trimmed, "base64"));
  } catch {
    throw new AuthError(
      400,
      "INVALID_SIGNATURE",
      "Signature must be encoded as base58, base64, or hex."
    );
  }
}
