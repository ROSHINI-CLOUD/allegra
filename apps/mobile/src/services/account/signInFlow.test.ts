import { MOBILE_AUTH_REDIRECT, codeFrom, runGoogleSignIn } from './signInFlow';

type Params = { redirectTo?: string; code?: string };

const fakeSignIn = (finish: { signingIn: boolean } = { signingIn: true }) => {
  const calls: Params[] = [];
  const signIn = async (_provider: string, params: Params) => {
    calls.push(params);
    return params.code ? finish : { signingIn: false, redirect: new URL('https://accounts.google.com/o/oauth2/auth?x=1') };
  };
  return { signIn, calls };
};

describe('runGoogleSignIn', () => {
  it('opens Google, then trades the returned code for a session', async () => {
    const { signIn, calls } = fakeSignIn();
    const opened: string[] = [];
    const outcome = await runGoogleSignIn(signIn, async (url, back) => {
      opened.push(url, back);
      return { type: 'success', url: `${MOBILE_AUTH_REDIRECT}?code=abc%2F123` };
    });
    expect(outcome).toBe('signed-in');
    expect(calls).toEqual([{ redirectTo: MOBILE_AUTH_REDIRECT }, { code: 'abc/123' }]);
    expect(opened[1]).toBe(MOBILE_AUTH_REDIRECT);
  });

  it('is cancelled when the listener closes the browser', async () => {
    const { signIn, calls } = fakeSignIn();
    expect(await runGoogleSignIn(signIn, async () => ({ type: 'cancel' }))).toBe('cancelled');
    expect(calls).toHaveLength(1);
  });

  it('fails without a code, when the server refuses, or when anything throws', async () => {
    expect(await runGoogleSignIn(fakeSignIn().signIn, async () => ({ type: 'success', url: MOBILE_AUTH_REDIRECT }))).toBe('failed');
    expect(
      await runGoogleSignIn(fakeSignIn({ signingIn: false }).signIn, async () => ({ type: 'success', url: `${MOBILE_AUTH_REDIRECT}?code=x` })),
    ).toBe('failed');
    const throwing = async () => {
      throw new Error('network');
    };
    expect(await runGoogleSignIn(throwing, async () => ({ type: 'success', url: '' }))).toBe('failed');
  });
});

describe('codeFrom', () => {
  it('reads the code param wherever it sits', () => {
    expect(codeFrom('lyricflow://auth?code=q1')).toBe('q1');
    expect(codeFrom('lyricflow://auth?state=s&code=q2#frag')).toBe('q2');
    expect(codeFrom('lyricflow://auth?error=access_denied')).toBeNull();
  });
});
