# Migration Guides

This directory contains migration-oriented documentation for teams adopting Vasto from other job systems.

## Available guides

- [From BullMQ](from-bullmq.md) — Migration path with concept mapping and rollout checklist
- [BullMQ Compatibility Assessment](bullmq-parity-assessment.md) — Feature mapping notes to support migration planning

## Recommended workflow

1. Read the concept mapping section.
2. Convert one queue and one worker first.
3. Validate retries, delayed jobs, and DLQ behavior.
4. Migrate flows and scheduled jobs after single-job parity is stable.
5. Adopt reliability controls and dashboard observability during rollout.
