import type { Plugin, StoredJob } from '@omni-queue/core';
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
      'omni.queue.job.id': job.id,
      'omni.queue.job.name': job.name,
      'omni.queue.name': job.queue,
      'omni.queue.attempts': job.attempts,
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
