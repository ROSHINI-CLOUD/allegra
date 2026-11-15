import * as fs from 'fs';
import * as path from 'path';
import { CONTACT_MAX, FEEDBACK_MAX, feedbackProblem } from '../services/feedbackDraft';
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

describe('messages services/feedback.ts throws', () => {
  it.each([
    'The server turned it away. Try again in a bit.',
    'Could not reach the server. Try again in a bit.',
    'That took too long. Check your connection and try again.',
  ])('keeps "%s" as it is', message => {
    expect(plainErrorMessage(new Error(message), FALLBACK)).toBe(message);
  });

  it('keeps each rule message a bug report can be rejected with', () => {
    const drafts = [
      { message: 'hi' },
      { message: 'x'.repeat(FEEDBACK_MAX + 1) },
      { message: 'Something broke here', contact: 'x'.repeat(CONTACT_MAX + 1) },
    ];
    for (const draft of drafts) {
      const problem = feedbackProblem(draft);
      expect(problem).not.toBeNull();
      expect(plainErrorMessage(new Error(problem ?? ''), FALLBACK)).toBe(problem);
    }
  });
});

describe('AboutSheet', () => {
  it('sends its send error through the same helper as the rest of the app', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'components', 'about', 'AboutSheet.tsx'), 'utf8');
    expect(source).toContain("plainErrorMessage(e, 'Could not send it. Try again in a bit.')");
    expect(source).not.toMatch(/\be\.message\b/);
  });
});
