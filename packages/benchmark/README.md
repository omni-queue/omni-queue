# Vasto Benchmark Suite

Performance benchmarks comparing Vasto against BullMQ, bee-queue, and pg-boss across six standardised scenarios.

Vasto is benchmarked on the matching backend where possible: in-memory for baseline runtime cost, Redis against BullMQ and bee-queue, and Postgres against pg-boss.

## Requirements

| Dependency | Notes |
|---|---|
| Node.js ≥ 20 | Uses `performance.now()`, `crypto.randomUUID()` |
| Redis | Required for BullMQ, bee-queue, and Vasto Redis scenarios |
| Postgres (optional) | Required for pg-boss and Vasto Postgres scenarios |

## Setup

```bash
# From the monorepo root, install all workspace deps
npm install

# Build @vasto-queue/core, @vasto-queue/redis-store, and @vasto-queue/postgres-store first
npm run build:core
```

### Local Infra (Redis + Postgres)

```bash
cd packages/benchmark
npm run infra:up

# Optional: reset volumes if you want a clean DB
npm run infra:reset

# Tear down
npm run infra:down
```

## Running

```bash
cd packages/benchmark

# Run all scenarios
npm run run:all

# Run a single scenario
npm run run:enqueue
npm run run:processing
npm run run:latency
npm run run:concurrency
npm run run:delayed
npm run run:memory

# Custom iterations
node --loader ts-node/esm src/runner.ts --scenario enqueue-throughput --iterations 20

# Save raw output to results/run-<timestamp>.json
node --loader ts-node/esm src/runner.ts --all --save

# Load vars from .env (auto-loaded if present)
cp .env.example .env
node --loader ts-node/esm src/runner.ts --all --save

# Or explicitly provide a file
node --loader ts-node/esm src/runner.ts --all --env-file .env.bench --save

# Regenerate chart artifacts from an existing saved run
npm run charts -- --input results/run-<timestamp>.json
```

Saved files include:

- Machine metadata (CPU model/core count, memory, OS/arch, Node.js version)
- Dependency versions used in the run
- Per-scenario structured reports with raw result rows
- Flat CSV output for spreadsheets/BI/charting tools
- Mermaid chart markdown for quick visual comparison in docs/PRs

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | *(unset — Redis-backed scenarios skipped)* | Redis connection for BullMQ, bee-queue, and Vasto Redis |
| `POSTGRES_URL` | *(unset — Postgres-backed scenarios skipped)* | Postgres DSN for pg-boss and Vasto Postgres |
| `VASTO_BENCH_KEEP_PG_TABLES` | `false` | Keep Vasto Postgres benchmark tables after each scenario run for manual DB inspection |
| `VASTO_BENCH_PG_TABLE_BASE` | *(auto-generated)* | Optional fixed table base (e.g. `vasto_bench_debug`), creating `<base>_jobs` and `<base>_dead_letter` |
| `VASTO_BENCH_COMPARE_PARTITIONS` | `false` | In `enqueue-throughput`, run both `vasto-postgres-unpartitioned` and `vasto-postgres-partitioned` for side-by-side comparison |
| `VASTO_BENCH_DISABLE_QUEUE_PARTITIONS` | `false` | Force Vasto Postgres fixture to avoid queue LIST partitioning |
| `VASTO_BENCH_ENQUEUE_CHUNK_SIZE` | *(unset)* | Override Vasto enqueue dispatch chunk size in benchmarks |

The runner automatically loads `.env` from `packages/benchmark` if present. You can override this with `--env-file <path>`.

When `VASTO_BENCH_KEEP_PG_TABLES=1`, the runner logs the exact Vasto Postgres table names it preserved.

## Scenarios

| Scenario | What it measures |
|---|---|
| `enqueue-throughput` | Jobs per second dispatched to storage (no workers) |
| `processing-throughput` | End-to-end jobs per second through a running worker |
| `latency-distribution` | p50/p95/p99/max from dispatch to job start (concurrency 1) |
| `concurrency-scaling` | Processing throughput at concurrency 1 / 5 / 10 / 25 |
| `delayed-job-accuracy` | Mean drift between scheduled and actual execution time (ms) |
| `memory-footprint` | RSS delta after queuing 10,000 jobs with no workers |

## Library Coverage by Scenario

Coverage below reflects the default runner behavior when the corresponding backend URLs are set.

| Scenario | vasto-memory | vasto-redis | vasto-postgres | bullmq | bee-queue | pg-boss |
|---|---:|---:|---:|---:|---:|---:|
| `enqueue-throughput` | yes | yes | yes | yes | yes | yes |
| `processing-throughput` | yes | yes | yes | yes | yes | yes |
| `latency-distribution` | yes | yes | yes | yes | yes | yes |
| `concurrency-scaling` | yes | yes | yes | yes | no | yes |
| `delayed-job-accuracy` | yes | yes | yes | yes | yes | yes |
| `memory-footprint` | yes | yes | yes | yes | yes | yes |

## Fairness Rules

- All libraries receive identical no-op job payloads (`{ index: number, data: string }`).
- Warmup rounds (default: 3) are always excluded from measurements.
- Redis-backed libraries share one Redis instance; Postgres-backed libraries share one Postgres instance.
- Results tables always include Node.js version, platform, and library versions (printed at run time).
- Memory benchmarks note that Redis-backed and Postgres-backed remote stores mostly reflect client heap only.

## Results

Committed summary tables live in [`results/`](./results/). Raw per-run JSON files are gitignored.

When you run with `--save`, the runner now emits three files side-by-side:

- `run-<timestamp>.json` — full structured result payload
- `run-<timestamp>.csv` — flattened chart-friendly rows
- `run-<timestamp>.charts.md` — Mermaid charts generated from the saved JSON

## CI Smoke Benchmark

GitHub Actions workflow: `.github/workflows/benchmark-smoke.yml`

- Runs on PRs touching benchmark/core queue code
- Starts Redis service
- Executes a lightweight smoke subset (`enqueue-throughput`, `latency-distribution`)
- Uploads JSON artifacts from `packages/benchmark/results/`

## Adding a Scenario

1. Create `src/scenarios/<name>.ts` and export an `async run(opts)` function.
2. Add `<name>` to the `SCENARIOS` array in `src/runner.ts`.
3. Add an npm script alias in `package.json`.
