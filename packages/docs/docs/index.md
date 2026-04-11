---
layout: home

hero:
  name: Vasto Queue
  text: TypeScript-first job queue runtime
  tagline: Flexible worker isolation, pluggable storage backends, and a production-grade supervisor — all in one package.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/vastohq/vasto

features:
  - icon: 🔒
    title: Three isolation modes
    details: Run jobs inline, in worker threads, or in full OS processes. Pick the right tradeoff between overhead and fault containment per queue.
    link: /guide/workers-and-isolation
    linkText: Learn about isolation

  - icon: 🗄️
    title: Pluggable storage
    details: Redis, Postgres, MySQL, MongoDB, DynamoDB, local file, or in-memory. Swap backends without touching your job code.
    link: /guide/storage-backends
    linkText: Compare adapters

  - icon: 🧩
    title: Lifecycle plugins
    details: Hook into enqueue, execution start/end, failure, and scheduling events with a consistent plugin interface across all backends.
    link: /guide/plugins-and-lifecycle
    linkText: Explore plugins

  - icon: ⚙️
    title: Declarative configuration
    details: defineQueues() and defineWorkers() produce plain config objects — no magic, fully type-safe, easy to test and serialise.
    link: /guide/core-concepts
    linkText: Core concepts

  - icon: 📅
    title: Built-in scheduling
    details: Delay jobs, run them at a fixed time, repeat on a cron pattern, or set interval-based schedules. Durable persistence is optional.
    link: /api/core-runtime
    linkText: API reference

  - icon: 📊
    title: First-party dashboard
    details: Publish a monitoring dashboard to any Express, Hono, Fastify, Elysia or NestJS app with a single adapter call.
    link: /guide/dashboard-and-monitoring
    linkText: Dashboard setup
---
