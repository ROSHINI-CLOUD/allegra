import { onlineStatus, type OnlineStatus, type OnlineStatusInput } from './searchStatus';

const none: readonly unknown[] = [];

describe('onlineStatus', () => {
  it.each<[string, OnlineStatusInput, OnlineStatus]>([
    ['fresh results show as results', { busy: false, online: none, fresh: 3, failed: false }, 'results'],
    ['fresh results beat a request still in flight', { busy: true, online: none, fresh: 3, failed: false }, 'results'],
    ['a request in flight with no answer yet is busy', { busy: true, online: null, fresh: 0, failed: false }, 'busy'],
    ['a failed request with nothing fresh is failed', { busy: false, online: none, fresh: 0, failed: true }, 'failed'],
    ['busy beats failed while the retry runs', { busy: true, online: none, fresh: 0, failed: true }, 'busy'],
    ['no query yet is idle', { busy: false, online: null, fresh: 0, failed: false }, 'idle'],
    ['an answer with nothing streamable is empty', { busy: false, online: none, fresh: 0, failed: false }, 'empty'],
    ['a thrown request that left no answer is still failed', { busy: false, online: null, fresh: 0, failed: true }, 'failed'],
  ])('%s', (_name, input, expected) => {
    expect(onlineStatus(input)).toBe(expected);
  });
});
