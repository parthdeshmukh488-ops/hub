# Compute units

Measured on 2026-09-30 by `tests/compute_units.rs`, which runs the committed `artifacts/programs/leash.so` and the audited `subscriptions.so` (tag `program-v0.5.0`) in LiteSVM 0.17 (Agave 4.3). Print the table again with:

```bash
cargo test -p leash --test compute_units -- --nocapture
```

Each figure is the whole transaction's compute units for that one instruction: the account checks, the handler, and the `emit_cpi!` self-CPI. For `pay` it also covers the Subscriptions CPI (with its own event self-CPI) and the token transfer inside it.

| Instruction | Case | Compute units |
| --- | --- | ---: |
| `initialize_principal` | with a guardian | 14,585 |
| `create_agent` | | 16,535 |
| `add_payee` | | 17,410 |
| `remove_payee` | | 13,414 |
| `close_agent` | | 10,226 |
| `set_guardian` | | 7,087 |
| `update_policy` | | 10,902 |
| `update_payee` | | 12,524 |
| `freeze_agent` | by the guardian | 10,593 |
| `unfreeze_agent` | | 10,018 |
| `freeze_principal` | by the guardian | 7,018 |
| `unfreeze_principal` | | 6,449 |
| `pay` | recurring allowance, first payment | 31,711 |
| `pay` | recurring allowance, later payment | 31,770 |
| `pay` | fixed allowance | 31,563 |
| `pay` | with an approved request (closes it) | 33,222 |
| `request_payment` | | 23,662 |
| `approve_request` | | 12,198 |
| `reject_request` | by the guardian | 14,229 |
| `expire_request` | | 11,397 |
| `report_denied_attempt` | strike | 16,807 |
| `report_denied_attempt` | third strike, trips the wire | 19,295 |

## Budgets

- **`pay` without a request must stay under 100,000** (01-onchain-program §11.4). It uses about a third of that. The test fails if any `pay` without a request reaches the budget.
- **The x402 transaction** `[SetComputeUnitLimit, SetComputeUnitPrice, pay, Memo]` uses 32,299 in total (`tests/x402_shape.rs`). The SDK simulates at a 400,000 limit and then sets `ceil(units × 1.15)` (02-contracts §9), about 37,200 here.
- Largest contributors to `pay`: the Subscriptions CPI (it re-derives the owner's associated token account and emits its own event), Leash's own check of the same ATA derivation, the token transfer, and the two `emit_cpi!` self-CPIs.
