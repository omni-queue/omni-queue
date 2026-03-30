# `@omni-queue/express-adapter`

Default framework adapter for Omni-Queue dashboard integration.

Built on top of `@omni-queue/dashboard-api` and intended for Express/Connect-compatible apps.

## Installation

```bash
npm install @omni-queue/express-adapter
```

## Usage

```ts
import express from 'express';
import { createExpressAdapter } from '@omni-queue/express-adapter';

const app = express();
app.use(createExpressAdapter({ supervisor }));
```
