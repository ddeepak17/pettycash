-- Petty Cash data model. Everything lives in its own schema and is reached through a role that can touch nothing else.
create schema if not exists pettycash;

-- One agent run: a task a person gave the agent, and how it ended.
create table if not exists pettycash.runs (
  id            uuid primary key default gen_random_uuid(),
  owner         text not null,                 -- wallet that owns the petty cash (base58)
  delegation    text not null,                 -- the allowance account the run spent from
  cluster       text not null,                 -- mainnet-beta | devnet
  task          text not null,
  status        text not null default 'running', -- running | awaiting_approval | done | failed | stopped
  answer        text,
  spent_base    bigint not null default 0,     -- total paid to sellers, in token base units
  model         text,
  is_house      boolean not null default false, -- true when the run used the public demo allowance
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists runs_owner_idx on pettycash.runs (owner, created_at desc);
create index if not exists runs_created_idx on pettycash.runs (created_at desc);

-- The run's timeline, in order. The browser replays this to show what the agent did and why.
create table if not exists pettycash.events (
  id         bigserial primary key,
  run_id     uuid not null references pettycash.runs (id) on delete cascade,
  seq        int not null,
  type       text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

-- One attempted purchase: the seller's offer, our policy decision, and both transactions.
create table if not exists pettycash.purchases (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid references pettycash.runs (id) on delete cascade,
  owner            text not null,
  cluster          text not null,
  seller_url       text not null,
  seller_host      text not null,
  seller_name      text,
  method           text not null default 'GET',
  pay_to           text not null,
  mint             text not null,
  amount_base      bigint not null,
  quote            jsonb not null,             -- the payment requirement exactly as the seller offered it
  policy           jsonb not null,             -- the decision and every rule that was checked
  status           text not null,              -- denied | awaiting_approval | pulled | paid | delivered | failed | refunded
  pull_sig         text,                       -- allowance pull: owner wallet -> agent wallet
  pay_sig          text,                       -- x402 payment: agent wallet -> seller
  refund_sig       text,                       -- money returned to the owner when a purchase did not complete
  http_status      int,
  response_sha256  text,
  response_bytes   int,
  response_preview text,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists purchases_owner_idx on pettycash.purchases (owner, created_at desc);
create index if not exists purchases_run_idx on pettycash.purchases (run_id);
create index if not exists purchases_pull_idx on pettycash.purchases (pull_sig);
create index if not exists purchases_pay_idx on pettycash.purchases (pay_sig);

-- What QuickNode Streams delivered. A receipt is only called verified when a row here matches it.
create table if not exists pettycash.stream_deliveries (
  signature    text primary key,
  slot         bigint not null,
  block_time   bigint,
  ok           boolean not null,
  payload      jsonb not null,                 -- decoded by the stream filter: token movements, programs, fee payer
  stream_id    text,
  received_at  timestamptz not null default now()
);
create index if not exists deliveries_received_idx on pettycash.stream_deliveries (received_at desc);

-- Replay guard for webhook deliveries.
create table if not exists pettycash.webhook_nonces (
  nonce       text primary key,
  received_at timestamptz not null default now()
);

-- A person's answer when the agent asks before a larger purchase.
create table if not exists pettycash.approvals (
  purchase_id uuid primary key references pettycash.purchases (id) on delete cascade,
  decision    text not null,                   -- approved | denied
  decided_at  timestamptz not null default now()
);

-- Fixed-window counters for public endpoints.
create table if not exists pettycash.rate_limits (
  key          text primary key,
  count        int not null,
  window_start timestamptz not null
);

-- Small key-value settings (for example: when the stream was last switched on).
create table if not exists pettycash.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
