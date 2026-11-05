-- Weekly pool accounting is opt-in. Existing order and commission rows are
-- untouched. The weekly writer and protected credit path must be installed
-- before a cutover is enabled.
CREATE TABLE product_binary_pool_weeks (
  week_start date PRIMARY KEY CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  max_rate_centavos integer NOT NULL CHECK (max_rate_centavos BETWEEN 50 AND 2000),
  closed_at timestamptz,
  total_pairs bigint,
  pool_centavos bigint,
  allocated_centavos bigint,
  CHECK (
    (closed_at IS NULL AND total_pairs IS NULL AND pool_centavos IS NULL AND allocated_centavos IS NULL)
    OR (
      closed_at IS NOT NULL AND total_pairs IS NOT NULL
      AND pool_centavos IS NOT NULL AND allocated_centavos IS NOT NULL
      AND closed_at >= ((week_start + 7)::timestamp AT TIME ZONE 'Asia/Manila')
      AND total_pairs >= 0 AND pool_centavos >= 0
      AND allocated_centavos BETWEEN 0 AND pool_centavos
    )
  )
);

-- One qualified order event can fund exactly one week.
CREATE TABLE product_binary_pool_orders (
  order_event_id uuid PRIMARY KEY REFERENCES product_binary_order_events(id),
  week_start date NOT NULL REFERENCES product_binary_pool_weeks(week_start),
  UNIQUE (week_start, order_event_id)
);
CREATE INDEX product_binary_pool_orders_week_idx ON product_binary_pool_orders(week_start);

-- Individual entitlements reference a pair event and are assigned to the
-- same week as the order event that triggered the match.
ALTER TABLE product_binary_pair_events
  ADD CONSTRAINT product_binary_pair_events_id_order_unique UNIQUE (id, order_event_id);

CREATE TABLE product_binary_pool_pairs (
  pair_event_id uuid PRIMARY KEY,
  order_event_id uuid NOT NULL,
  week_start date NOT NULL,
  FOREIGN KEY (pair_event_id, order_event_id)
    REFERENCES product_binary_pair_events(id, order_event_id),
  FOREIGN KEY (week_start, order_event_id)
    REFERENCES product_binary_pool_orders(week_start, order_event_id)
);
CREATE INDEX product_binary_pool_pairs_week_idx ON product_binary_pool_pairs(week_start);

CREATE TABLE product_binary_pool_allocations (
  week_start date NOT NULL REFERENCES product_binary_pool_weeks(week_start),
  recipient_user_id text NOT NULL REFERENCES users(id),
  payable_pairs bigint NOT NULL CHECK (payable_pairs > 0),
  amount_centavos bigint NOT NULL CHECK (amount_centavos >= 0),
  commission_id text UNIQUE REFERENCES commissions(id),
  PRIMARY KEY (week_start, recipient_user_id),
  CHECK (commission_id IS NULL OR amount_centavos > 0)
);

REVOKE ALL ON product_binary_pool_weeks, product_binary_pool_orders,
  product_binary_pool_pairs, product_binary_pool_allocations FROM PUBLIC;
