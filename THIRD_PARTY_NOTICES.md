# Third-party notices

Petty Cash is licensed under the MIT License (see [LICENSE](LICENSE)). It depends on the software below. Each package is installed from the npm registry and keeps its own license. The license named here is the one declared in the package's `package.json`, checked against the license file shipped in the package where there is one.

Versions are the ones resolved in `pnpm-lock.yaml` on 2026-11-20.

## Runtime dependencies

| Package | Version | License | Copyright holder, as stated by the package |
|---|---|---|---|
| `next` | 15.5.29 | MIT | Vercel, Inc. |
| `react` | 19.1.0 | MIT | Meta Platforms, Inc. and affiliates |
| `react-dom` | 19.1.0 | MIT | Meta Platforms, Inc. and affiliates |
| `@solana/web3.js` | 1.99.0 | MIT | Solana Labs, Inc |
| `@solana/kit` | 8.6.0 | MIT | Solana Labs, Inc |
| `@solana/spl-token` | 0.4.15 | Apache-2.0 | Not named in the package |
| `@solana/wallet-adapter-base` | 0.9.28 | Apache-2.0 | Solana Maintainers (package author) |
| `@solana/wallet-adapter-react` | 0.15.40 | Apache-2.0 | Solana Maintainers (package author) |
| `@x402/core` | 2.30.0 | Apache-2.0 | x402 Foundation |
| `@x402/svm` | 2.30.0 | Apache-2.0 | x402 Foundation |
| `@x402/fetch` | 2.30.0 | Apache-2.0 | x402 Foundation |
| `postgres` | 4.1.1 | Unlicense | Public domain dedication. The package ships no license file |
| `tweetnacl` | 1.0.3 | Unlicense | Public domain dedication |
| `bs58` | 6.0.0 | MIT | cryptocoinjs |
| `buffer` | 6.0.3 | MIT | The package's author and contributors |
| `geist` | 1.9.2 | SIL Open Font License 1.1 | Vercel, in collaboration with basement.studio |

The three `@x402` packages ship a `NOTICE` file: "Copyright 2026 x402 Foundation. Licensed under the Apache License, Version 2.0".

`geist` is a font package. The Geist Sans and Geist Mono fonts are used in the interface under the SIL Open Font License, Version 1.1.

## Development dependencies

These are used to build and test. They are not part of the deployed application.

| Package | Version | License | Copyright holder, as stated by the package |
|---|---|---|---|
| `typescript` | 5.9.3 | Apache-2.0 | Microsoft Corp. (package author) |
| `tailwindcss` | 4.3.5 | MIT | Tailwind Labs, Inc. |
| `@tailwindcss/postcss` | 4.3.5 | MIT | Tailwind Labs, Inc. |
| `vitest` | 5.1.1 | MIT | VoidZero Inc. and Vitest contributors |
| `tsx` | 4.23.15 | MIT | The package's author |
| `playwright-core` | 1.65.1 | Apache-2.0 | Microsoft Corporation |
| `eslint` | 9.39.5 | MIT | OpenJS Foundation and other contributors |
| `eslint-config-next` | 15.5.29 | MIT | Not named. The package ships no license file |
| `@eslint/eslintrc` | 3.3.7 | MIT | OpenJS Foundation and other contributors |
| `@types/node` | 20.19.43 | MIT | Microsoft Corporation |
| `@types/react` | 19.3.0 | MIT | Microsoft Corporation |
| `@types/react-dom` | 19.3.0 | MIT | Microsoft Corporation |

Each of these packages brings its own dependencies, with their own licenses. `pnpm licenses list` prints the full tree.

## Onchain programs and services

These are not bundled with Petty Cash. They are listed so that nothing we rely on is hidden.

| What | How it is used | Terms |
|---|---|---|
| Solana Subscriptions and Allowances program, `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44` | Called onchain. Petty Cash contains its own instruction builders for it, written from the program's published interface. No program source code is included | The program's source repository, [github.com/solana-foundation/subscriptions](https://github.com/solana-foundation/subscriptions), is under the MIT License |
| SPL Token, Associated Token Account, Compute Budget and Memo programs | Called onchain through `@solana/spl-token` and `@solana/web3.js` | See those packages above |
| QuickNode Streams | A hosted service that runs `infra/quicknode/filter.js` and delivers to our webhook | QuickNode's terms of service |
| The sellers in `src/lib/agent/catalog.ts` | Paid per request over x402. No code of theirs is included | Each seller's own terms |

Product and company names are the property of their owners. Their appearance here does not imply endorsement.
