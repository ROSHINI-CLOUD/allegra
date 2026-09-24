import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

export { expect };

export const SEARCH_QUERY = process.env.E2E_QUERY ?? 'arijit singh';

/**
 * Every test starts as a first-time visitor, who is offered taste onboarding over the
 * page. Tests about something else skip it whenever it shows up; onboarding itself has
 * its own test on the plain `test`.
 */
export const test = base.extend<{ skipOnboarding: void }>({
  skipOnboarding: [
    async ({ page }, use) => {
      await page.addLocatorHandler(page.getByRole('button', { name: 'Skip for now' }), async (skip) => {
        await skip.click();
      });
      await use();
    },
    { auto: true }
  ]
});

/** Uncaught exceptions on the page. A test that ends with any of these fails. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

export async function firstSongId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`/api/search?q=${encodeURIComponent(SEARCH_QUERY)}`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { data?: { results?: Array<{ id: string }> } };
  const id = body.data?.results?.[0]?.id;
  expect(id, 'search returned no songs').toBeTruthy();
  return id!;
}

export interface AudioState {
  readonly paused: boolean;
  readonly time: number;
  readonly src: string;
}

export async function audioState(page: Page): Promise<AudioState> {
  return page.evaluate(() => {
    const audio = document.querySelector('audio');
    return { paused: audio?.paused ?? true, time: audio?.currentTime ?? 0, src: audio?.currentSrc ?? '' };
  });
}

/** Waits until the layout's <audio> element is playing and its clock is moving. */
export async function expectPlaying(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const first = await audioState(page);
      await page.waitForTimeout(400);
      const second = await audioState(page);
      return !second.paused && second.time > first.time;
    }, { timeout: 30_000, message: 'audio never started playing' })
    .toBe(true);
}

/** Home page → press play on the first song card. */
export async function startPlayback(page: Page): Promise<void> {
  await page.goto('/');
  const play = page.getByRole('button', { name: /^Play .+/ }).first();
  await expect(play).toBeVisible({ timeout: 30_000 });
  await play.click();
  await expectPlaying(page);
}
