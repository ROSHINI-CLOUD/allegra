import { plainErrorMessage } from './plainError';

const FALLBACK = 'Could not do that. Try again.';

describe('plainErrorMessage', () => {
  it('keeps a sentence the app wrote itself', () => {
    expect(plainErrorMessage(new Error('Leave your Echo room before starting a LuvLink.'), FALLBACK))
      .toBe('Leave your Echo room before starting a LuvLink.');
  });

  it('reads the message out of a ConvexError instead of showing its JSON', () => {
    const error = Object.assign(new Error('{"code":"invalid_invite","message":"That LuvLink code is not valid."}'), {
      data: { code: 'invalid_invite', message: 'That LuvLink code is not valid.' },
    });
    expect(plainErrorMessage(error, FALLBACK)).toBe('That LuvLink code is not valid.');
  });

  it('turns a failed fetch into a connection line', () => {
    expect(plainErrorMessage(new TypeError('Network request failed'), FALLBACK)).toBe('Check your connection and try again.');
    expect(plainErrorMessage('Request timed out', FALLBACK)).toBe('Check your connection and try again.');
  });

  it('hides server and stack text behind the fallback', () => {
    expect(plainErrorMessage(new Error('[CONVEX M(luvLink:join)] [Request ID: abc] Server Error'), FALLBACK)).toBe(FALLBACK);
    expect(plainErrorMessage(new Error('TypeError: undefined is not an object'), FALLBACK)).toBe(FALLBACK);
    expect(plainErrorMessage(new Error('HTTP 503'), FALLBACK)).toBe(FALLBACK);
    expect(plainErrorMessage(new Error('{"error":"x"}'), FALLBACK)).toBe(FALLBACK);
  });

  it('falls back for empty or very long messages and non-errors', () => {
    expect(plainErrorMessage(new Error(''), FALLBACK)).toBe(FALLBACK);
    expect(plainErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(plainErrorMessage(new Error('a'.repeat(300)), FALLBACK)).toBe(FALLBACK);
  });
});
