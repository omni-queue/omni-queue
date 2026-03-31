import { describe, expect, it } from 'vitest';
import { createElysiaAdapter, omniQueueElysiaAdapter, registerElysiaAdapter } from './index';

describe('@omni-queue/elysia-adapter exports', () => {
	it('exports adapter functions', () => {
		expect(createElysiaAdapter).toBeTypeOf('function');
		expect(omniQueueElysiaAdapter).toBeTypeOf('function');
		expect(registerElysiaAdapter).toBeTypeOf('function');
	});
});