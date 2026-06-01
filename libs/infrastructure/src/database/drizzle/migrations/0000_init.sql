CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email varchar(255) NOT NULL UNIQUE,
  name varchar(255) NOT NULL,
  balance_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY,
  actor_id varchar(255),
  actor_type varchar(50) NOT NULL,
  action varchar(255) NOT NULL,
  entity_type varchar(255),
  entity_id varchar(255),
  metadata jsonb,
  ip varchar(64),
  user_agent varchar(512),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY,
  event_name varchar(255) NOT NULL,
  payload jsonb NOT NULL,
  status varchar(50) NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY,
  key varchar(255) NOT NULL,
  scope varchar(255) NOT NULL,
  request_hash varchar(255) NOT NULL,
  response_payload jsonb,
  status varchar(50) NOT NULL,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, scope, request_hash)
);
