import { describe, expect, it } from 'vitest';
import { createElysiaAdapter, vastoElysiaAdapter, registerElysiaAdapter } from './index';

describe('@vasto-queue/elysia-adapter exports', () => {
	it('exports adapter functions', () => {
		expect(createElysiaAdapter).toBeTypeOf('function');
		expect(vastoElysiaAdapter).toBeTypeOf('function');
		expect(registerElysiaAdapter).toBeTypeOf('function');
	});
});