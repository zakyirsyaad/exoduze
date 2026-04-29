# Next.js template

This is a Next.js template with shadcn/ui.

## Environment

- `NEXT_PUBLIC_API_URL` points the frontend at the backend API.
- `NEXT_PUBLIC_SETTLEMENT_MINT` is the SPL mint used for USDC settlement.
- `NEXT_PUBLIC_TREASURY_TOKEN_ACCOUNT` is required for manual payout claims from the portfolio page and must be a valid Solana token-account public key, not a placeholder string.

## Run locally

```bash
npm install
npm run typecheck
npm run lint
npm run dev
```

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button";
```
