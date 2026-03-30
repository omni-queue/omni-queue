# `@omni-queue/express-adapter`

Default framework adapter for Omni-Queue dashboard integration.

Built on top of `@omni-queue/dashboard-api` and intended for Express/Connect-compatible apps.

This package does not start an HTTP server for you. Mount it into your existing Express app.

## Installation

```bash
npm install @omni-queue/express-adapter
```

## Usage

```ts
import express from 'express';
import { omniQueueExpressAdapter } from '@omni-queue/express-adapter';

const app = express();
app.use(
	omniQueueExpressAdapter({
		supervisor,
		apiBase: '/api/omni-queue',
	})
);
```
