# smartcontract-exoduze

Solana/Anchor program for Exoduze's on-chain prediction market flow.

The scaffold in this folder is intentionally aligned with the interfaces already used by:

- `backend-exoduze/src/modules/onchain/idl/exoduze_prediction_market.json`
- `frontend-exoduze/lib/exoduze-program.ts`

That means the new contract keeps the same program name, instruction names, PDA seeds, and account model expected by the existing app stack:

- `initialize_config`
- `create_market`
- `commit_agent_decision`
- `open_position`
- `resolve_market`
- `claim_payout`
- `cancel_market`
- admin controls for pause and config updates

## Layout

- `programs/exoduze_prediction_market/src/lib.rs`: main Solana program
- `idl/exoduze_prediction_market.json`: current IDL snapshot used by the backend
- `scripts/sync-idl.mjs`: copies a freshly generated Anchor IDL back into this repo and the backend repo
- `tests/exoduze_prediction_market.ts`: minimal Anchor workspace smoke test

## Important notes

- This machine had `cargo`/`rustc`, but did not have `anchor` or `solana` CLI installed when the scaffold was created.
- The current `declare_id!` and `Anchor.toml` use the existing Exoduze program id for compatibility with the backend/frontend code already checked in.
- If you deploy a fresh program id, update:
  - `programs/exoduze_prediction_market/src/lib.rs`
  - `Anchor.toml`
  - backend env `EXODUZE_PROGRAM_ID`
  - frontend env `NEXT_PUBLIC_EXODUZE_PROGRAM_ID`

## Recommended flow

1. Install Solana CLI and Anchor CLI.
2. Generate or choose the program keypair you want to deploy with.
3. Build the program:

```bash
pnpm install
pnpm build
```

4. After build, sync the generated IDL:

```bash
pnpm sync:idl
```

5. Point backend/frontend env vars to the deployed program id and settlement mint.

## Behavior

- Markets are created as PDA accounts with a PDA-owned SPL token vault.
- Agent commitments are PDA accounts keyed by `market + agent_authority`.
- Positions are PDA accounts keyed by `market + user + agent_commitment`.
- Position opening transfers settlement tokens into the market vault.
- Resolution supports `YES`, `NO`, or `None` for cancellation-style refunds.
- Claiming a resolved winning position pays the user and sends protocol fees to the treasury token account.
- Claiming a cancelled market refunds the original stake and marks the position as refunded.

## Local checks

Rust-only checks do not need Anchor CLI:

```bash
pnpm check
pnpm test:rust
```

Anchor integration tests do require Solana + Anchor CLI:

```bash
pnpm test
```

