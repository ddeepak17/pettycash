# Stream filter evidence

Recorded 2026-11-20. Everything below was run against real Solana mainnet blocks.
The filter ran in QuickNode's own sandbox (`POST /streams/rest/v1/streams/test_filter`, network `solana-mainnet`,
dataset `block`) through `pnpm tsx scripts/stream.ts test-filter <slot>`. The comparison numbers come from
`getTransaction` (jsonParsed) on the public RPC `https://api.mainnet-beta.solana.com`, a different provider.

For each test the filter's agent key was pointed at an account of a real transaction with
`AGENT_PUBLIC_KEY=<account>`. The file in the repository keeps the real agent key.

## Dataset

`block` on `solana-mainnet` delivers `stream.data = [block, ...]` and `stream.metadata`. Observed on slot 471669400:

- block: `slot`, `blockTime`, `blockHeight`, `parentSlot`, `blockhash`, `previousBlockhash`, `rewards`, `transactions`
- transaction: `transaction`, `meta`, `version` (`"legacy"`, `0` and `1` all occur in one block)
- account keys are objects `{ pubkey, signer, writable, source }`; addresses from lookup tables are already in the list
  with `source: "lookupTable"`, and there is no `meta.loadedAddresses`
- instructions carry `programId` directly; known programs are parsed (a memo's `parsed` is its text), others have
  base58 `data`
- `meta` has `err`, `status`, `fee`, `innerInstructions`, `logMessages`, `preTokenBalances`, `postTokenBalances`
  (each with `owner`, `mint`, `uiTokenAmount.amount`)

`programs_with_logs` was tested on the same block (slot 471671101) and rejected. For the payment in section 1 its
entry held `signature`, `slot`, `blockTime`, `success`, `logs` and `programInvocations`, and:

- `tokenBalances` listed only the balances AFTER the transaction (347560523 and 380643400), so a change cannot be
  computed from it;
- the fee payer (`2wKupLR9...`) appeared nowhere in the entry;
- `programInvocations` held only the Token program's instruction; ComputeBudget and Memo were visible only in the logs;
- a failure is a bare `success: false`, without the chain's error.

Both datasets are listed at 30 credits per block for Solana mainnet (QuickNode's billing page, not measured here).

## 1. Payment: USDC TransferChecked, version 0, third-party fee payer, Memo

- slot `471671101`
- signature `2G38it8REW3Uvh6piEFL1P4jGCZXPC1tQ8F6jDhiwPGj7x16h8QBDw3yymDRNye1BSioVjyFEZkrUajSkdjcjAnH`
- command: `AGENT_PUBLIC_KEY=5xoboHF74HbdWxAd4aBmNbQxVJ8Lwtr3M7Xx9wFfthPf pnpm tsx scripts/stream.ts test-filter 471671101` (HTTP 201)

Emitted by the filter:

```json
{
 "pettycash": 1,
 "agent": "5xoboHF74HbdWxAd4aBmNbQxVJ8Lwtr3M7Xx9wFfthPf",
 "network": "solana-mainnet",
 "streamId": "6e5abcac-a7af-4dd3-904b-3e0509706329",
 "matches": [
  {
   "signature": "2G38it8REW3Uvh6piEFL1P4jGCZXPC1tQ8F6jDhiwPGj7x16h8QBDw3yymDRNye1BSioVjyFEZkrUajSkdjcjAnH",
   "slot": 471671101,
   "blockTime": 1795163481,
   "ok": true,
   "err": null,
   "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4",
   "version": 0,
   "programs": [
    "ComputeBudget111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
   ],
   "allowances": false,
   "allowanceIxs": [],
   "memos": [
    "90ac14fb29898a47dd15456105662742"
   ],
   "movements": [
    {
     "owner": "5xoboHF74HbdWxAd4aBmNbQxVJ8Lwtr3M7Xx9wFfthPf",
     "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
     "deltaBase": "-10000"
    },
    {
     "owner": "7r4e5dwNS68MDaxbw7N8jbzHq7RCMBp9z6smHFH4NXWw",
     "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
     "deltaBase": "10000"
    }
   ]
  }
 ]
}
```

`getTransaction` for the same signature (slot 471671101, version 0, err null, fee payer `2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4`):

| token account owner | pre | post | post - pre |
|---|---|---|---|
| `5xoboHF74HbdWxAd4aBmNbQxVJ8Lwtr3M7Xx9wFfthPf` | 347570523 | 347560523 | -10000 |
| `7r4e5dwNS68MDaxbw7N8jbzHq7RCMBp9z6smHFH4NXWw` | 380633400 | 380643400 | 10000 |

The emitted movements equal post minus pre for both owners. The fee payer is the facilitator, not the payer.
The memo equals the `spl-memo` instruction's text.

## 2. Allowance pull: Subscriptions and Allowances program, instruction 5

- slot `471666304`
- signature `4Se2gzjUAr3eH5t4rSJvJ2mtz1XwvNpg1ZLimtnxmuuwLx51iQ41jW1Q28AaSsjwpYt2qPD7MA8Yg1Hc9oD986th`
- command: `AGENT_PUBLIC_KEY=GgR1Qn7i5tsxp1bKqXt4y96RHMkTbBjrmmf4GAuzuTwt pnpm tsx scripts/stream.ts test-filter 471666304` (HTTP 201)

Emitted by the filter:

```json
{
 "pettycash": 1,
 "agent": "GgR1Qn7i5tsxp1bKqXt4y96RHMkTbBjrmmf4GAuzuTwt",
 "network": "solana-mainnet",
 "streamId": "5e10f670-0a41-4599-af23-1aeb49211ede",
 "matches": [
  {
   "signature": "4Se2gzjUAr3eH5t4rSJvJ2mtz1XwvNpg1ZLimtnxmuuwLx51iQ41jW1Q28AaSsjwpYt2qPD7MA8Yg1Hc9oD986th",
   "slot": 471666304,
   "blockTime": 1795162447,
   "ok": true,
   "err": null,
   "feePayer": "62JLkPeE4oG65LRB3W3m52RVicmYq3xFHdv7TecCsPj5",
   "version": "legacy",
   "programs": [
    "SMRTzfY6DfH5ik3TKiyLFfXexV8uSG3d2UksSCYdunG",
    "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
   ],
   "allowances": true,
   "allowanceIxs": [
    5,
    228
   ],
   "memos": [],
   "movements": [
    {
     "owner": "GgR1Qn7i5tsxp1bKqXt4y96RHMkTbBjrmmf4GAuzuTwt",
     "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
     "deltaBase": "1531"
    },
    {
     "owner": "96Ly1bNBQgKRNPZv3ZNXCr3mxb7M4QH8Cyr6XGKMxSje",
     "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
     "deltaBase": "-1531"
    }
   ]
  }
 ]
}
```

`getTransaction` for the same signature (slot 471666304, version "legacy", err null):

| token account owner | pre | post | post - pre |
|---|---|---|---|
| `GgR1Qn7i5tsxp1bKqXt4y96RHMkTbBjrmmf4GAuzuTwt` | 7763 | 9294 | 1531 |
| `96Ly1bNBQgKRNPZv3ZNXCr3mxb7M4QH8Cyr6XGKMxSje` | 1001531 | 1000000 | -1531 |

The emitted movements equal post minus pre for both owners. `allowanceIxs` is `[5, 228]`: the recurring pull
(discriminator 5) and the program's call to itself that emits its event (first byte 228). In this transaction
another program invoked the Allowances program, so both are inner instructions; the filter reads top-level and
inner instructions alike.

## 3. Failed transaction (version 1), several matches in one block

- slot `471671101`
- command: `AGENT_PUBLIC_KEY=FeJNrmVP33n81agtPvkdnxuNd3s4sLWM3pojwQ3L2kXo pnpm tsx scripts/stream.ts test-filter 471671101` (HTTP 201)
- the filter returned 6 transactions of that account in the block, all failed; the first:

```json
{
 "signature": "5hkQkiv4Az6hmw4aCmr1gw6hmnqQWCg14wMKwWtWBvQtAkh4psuJnecxbDkM18CmAhwnJbmJFLDDomW4A4cMKVDq",
 "slot": 471671101,
 "blockTime": 1795163481,
 "ok": false,
 "err": {
  "InstructionError": [
   0,
   {
    "Custom": 1
   }
  ]
 },
 "feePayer": "FeJNrmVP33n81agtPvkdnxuNd3s4sLWM3pojwQ3L2kXo",
 "version": 1,
 "programs": [
  "H8DVS3FXkE7XNEQxdXostwuV8JpdxkjVzzyVW2b8g2Ts",
  "11111111111111111111111111111111",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
 ],
 "allowances": false,
 "allowanceIxs": [],
 "memos": [],
 "movements": []
}
```

`getTransaction` for `5hkQkiv4Az6hmw4aCmr1gw6hmnqQWCg14wMKwWtWBvQtAkh4psuJnecxbDkM18CmAhwnJbmJFLDDomW4A4cMKVDq` (it needs `maxSupportedTransactionVersion: 1`): slot 471671101,
version 1, err `{"InstructionError":[0,{"Custom":1}]}`, same fee payer, and every token balance identical before and after.
So a failed transaction is delivered with `ok: false`, the chain's own error and no movements.

## 4. No match

`pnpm tsx scripts/stream.ts test-filter 471671101` with the real agent key: HTTP 201, `result: null`.
The agent has no transaction in that block, so nothing would be delivered.

## Creating the stream: what QuickNode answered

`pnpm tsx scripts/stream.ts create https://pettycash.invalid/api/quicknode` was refused twice. No stream was created.

1. With `dataset_batch_size: 1`: HTTP 422, "solana-mainnet produces blocks in under one second, so streams without an
   end block need a batch size of at least 5. Enable Elastic Batch so blocks are delivered as soon as they are
   available instead of waiting for the batch to fill." The CLI now sends `dataset_batch_size: 5` with
   `elastic_batch_enabled: true`, so the filter can receive 1 to 5 blocks per call. It already loops over every
   block in `stream.data` (unit-tested with a three-block batch).
2. With those settings: HTTP 400, "Invalid stream input: webhook URL is not allowed: URL hostname could not be
   resolved". QuickNode needs a webhook hostname that resolves in DNS, so the stream can only be created once the
   app has a public address.

The account's other stream (`solsend-mvp-devnet`) was only ever listed. Its status (paused), start_range and
updated_at (2026-11-19T23:33:31Z) were identical before and after.

## Not verified

- Whether the plan allows a second stream: both refusals were about the request itself, so nothing was learned
  about a plan limit.
- A real delivery: the body QuickNode posts, its `x-qn-*` headers, and whether a retry reuses the nonce.
- `activate` on mainnet (move `start_range` to the tip, then activate) and `pause`.
- The filter on a batch of several blocks inside QuickNode (the test endpoint takes one block).
