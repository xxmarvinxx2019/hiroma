# Two-session release simulation

`npm run simulate:binary-5000` executes the production settlement function against an isolated in-memory transaction double. It does not connect to the configured database. It now models the daily/session allowance, accepted point lots and consumption, default-disabled product rewards, and the current policy of recording funding shortfalls rather than rejecting qualified cascades. The PR quality gate runs it as well as the production attestation workflow.

The root scenario asserts five eligible pairs in each session, rejection of the next source in each capped session, and duplicate-source rejection. Every scenario checks remaining lot balances against member carryover and consumed point evidence. Session usage must never exceed five. Actual SQL triggers, concurrency, and enabled bottle rewards remain covered separately by integration tests; this double is not a database or HTTP load benchmark.

Default deterministic results with 5,000 accounts, 600 Starter points per pair, PHP 300 per cash pair, and PHP 300 binary funding per registration:

| Scenario | Credited cash commission | Recorded unfunded creation | Incoming points flushed |
| --- | ---: | ---: | ---: |
| One root, two sessions plus post-cap attempts | PHP 3,000 | None | 1,200 |
| Balanced growth entirely in the first session, allocation funding only | PHP 1,873,500 | PHP 373,800 | 22,848,600 |
| Same balanced growth with a PHP 20 million opening measurement buffer | PHP 1,873,500 | None | 22,848,600 |
| Balanced growth with allowance reset before every registration and the same buffer | PHP 7,442,700 | None | 0 |

Funding gaps are recorded at the time each commission is created. Their cumulative sum can differ from the final net difference between contributions and credited commissions, because later contributions do not erase earlier unfunded records in this model. The legacy JSON field `paid` denotes credited commission, not bank payments.

The deep-chain scenarios also complete: one registration can produce one pair for each of 5,000 pre-positioned uplines. For example, PHP 1.5 million of credited cash against PHP 1.2 million opening reserve plus PHP 300 new funding records PHP 299,700 unfunded. The cap does not prevent each separate ancestor from earning its first pair.

These are stress constructions, not forecasts of real member placement or timing. Bottle rewards are disabled for this cash-exposure run; product costs, direct referral, shipping, operating expenses, refunds, and actual company gross margin are excluded. A passing simulation establishes the asserted rule behavior, not financial sustainability. The figures explicitly show that two sessions alone do not ensure all binary liabilities fit the per-registration binary allocation.
