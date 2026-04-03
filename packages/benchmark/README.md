# Vasto Benchmark Suite

Performance benchmarks comparing Vasto against BullMQ, bee-queue, and pg-boss across six standardised scenarios.

## Requirements

| Dependency | Notes |
|---|---|
| Node.js ≥ 20 | Uses `performance.now()`, `crypto.randomUUID()` |
| Redis | Required for BullMQ and bee-queue scenarios |
| Postgres (optional) | Required for pg-boss scenarios |

## Setup

```bash
# From the monorepo root, install all workspace deps
npm install

# Build @vasto/core and @vasto/redis-store first
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
```

Saved files include:

- Machine metadata (CPU model/core count, memory, OS/arch, Node.js version)
- Dependency versions used in the run
- Per-scenario structured reports with raw result rows

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | *(unset — Redis scenarios skipped)* | Redis connection for BullMQ and bee-queue |
| `POSTGRES_URL` | *(unset — pg-boss skipped)* | Postgres DSN for pg-boss |

The runner automatically loads `.env` from `packages/benchmark` if present. You can override this with `--env-file <path>`.

## Scenarios

| Scenario | What it measures |
|---|---|
| `enqueue-throughput` | Jobs per second dispatched to storage (no workers) |
| `processing-throughput` | End-to-end jobs per second through a running worker |
| `latency-distribution` | p50/p95/p99/max from dispatch to job start (concurrency 1) |
| `concurrency-scaling` | Processing throughput at concurrency 1 / 5 / 10 / 25 |
| `delayed-job-accuracy` | Mean drift between scheduled and actual execution time (ms) |
| `memory-footprint` | RSS delta after queuing 10,000 jobs with no workers |

## Fairness Rules

- All libraries receive identical no-op job payloads (`{ index: number, data: string }`).
- Warmup rounds (default: 3) are always excluded from measurements.
- Redis-backed libraries share one Redis instance; pg-boss uses one Postgres instance.
- Results tables always include Node.js version, platform, and library versions (printed at run time).
- Memory benchmarks note that Redis-backed library RSS reflects client heap only.

## Results

Committed summary tables live in [`results/`](./results/). Raw per-run JSON files are gitignored.

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
