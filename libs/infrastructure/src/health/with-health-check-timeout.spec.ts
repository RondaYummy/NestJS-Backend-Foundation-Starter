/// <reference types="jest" />

import { withHealthCheckTimeout } from './with-health-check-timeout';

describe('withHealthCheckTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves when the operation completes before the deadline', async () => {
    const resultPromise = withHealthCheckTimeout(Promise.resolve('ok'), 100);

    await jest.runAllTimersAsync();

    await expect(resultPromise).resolves.toBe('ok');
  });

  it('rejects with a generic timeout message when the deadline elapses first', async () => {
    const hangingOperation = new Promise<string>(() => {});
    const resultPromise = withHealthCheckTimeout(hangingOperation, 50);

    jest.advanceTimersByTime(50);

    await expect(resultPromise).rejects.toThrow('Health check timed out after 50ms');
  });

  it('clears the timer when the operation succeeds', async () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

    await withHealthCheckTimeout(Promise.resolve('ok'), 100);

    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });
});
