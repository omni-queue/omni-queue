import type { Plugin, StoredJob } from '@vasto-queue/core';
import { context, trace, Span, SpanStatusCode, type Tracer } from '@opentelemetry/api';

export interface TracingPluginOptions {
  tracer?: Tracer;
  tracerName?: string;
}

export class TracingPlugin implements Plugin {
  private readonly tracer: Tracer;
  private readonly spans = new Map<string, Span>();

  constructor(options: TracingPluginOptions = {}) {
    this.tracer = options.tracer ?? trace.getTracer(options.tracerName ?? 'queue-runtime');
  }

  async onProcessStart(job: StoredJob): Promise<void> {
    const span = this.tracer.startSpan(job.name, undefined, context.active());

    span.setAttributes({
      'vasto.queue.job.id': job.id,
      'vasto.queue.job.name': job.name,
      'vasto.queue.name': job.queue,
      'vasto.queue.attempts': job.attempts,
    });

    this.spans.set(job.id, span);
  }

  async onProcessEnd(job: StoredJob): Promise<void> {
    const span = this.spans.get(job.id);

    if (!span) {
      return;
    }

    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
    this.spans.delete(job.id);
  }

  async onFail(job: StoredJob, err: Error): Promise<void> {
    const span = this.spans.get(job.id);

    if (!span) {
      return;
    }

    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.end();
    this.spans.delete(job.id);
  }
}
