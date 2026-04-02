# metrics-lab

In-memory telemetry and exporter example.

## What this example demonstrates

- Runtime auto-collection with `QueueMetricsPlugin`
- Manual collector gauges via `MetricsCollector`
- Exporting the same snapshot to Prometheus, StatsD, and DataDog formats

## Run

From repository root:

```bash
npm install
npm run build
```

Then run:

```bash
cd examples/metrics-lab
npm run dev
```
