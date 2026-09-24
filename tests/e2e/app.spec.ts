import { test as plain } from '@playwright/test';

import { audioState, collectPageErrors, expect, expectPlaying, startPlayback, test } from './helpers';

const bar = '[aria-label="Player bar"]';

plain('a first visit offers taste onboarding and "Not now" dismisses it', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog').filter({ has: page.locator('#taste-title') });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Search music' }).first()).toBeVisible();
});

test('every section renders without a page error', async ({ page }) => {
  const errors = collectPageErrors(page);
  for (const path of ['/', '/discover', '/library', '/liked', '/artist/Arijit%20Singh', '/not-a-real-page']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBeLessThan(400);
    await expect(page.locator('#main-content'), path).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browse' }).first(), path).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('search finds a song and plays it', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Search music' }).first().click();
  const box = page.getByRole('combobox');
  await expect(box).toBeVisible();
  await box.fill('Tum Hi Ho');
  const option = page.getByRole('option').first();
  await expect(option).toBeVisible({ timeout: 20_000 });
  await option.click();
  await expectPlaying(page);
  expect((await audioState(page)).src).toContain('/api/stream/');
  expect(errors).toEqual([]);
});

test('pause stays paused and play resumes (one playback funnel)', async ({ page }) => {
  await startPlayback(page);
  await page.locator(bar).getByRole('button', { name: 'Pause' }).click();
  // Invariant 2: a load effect keyed on isPlaying would resume this within a tick.
  await page.waitForTimeout(1500);
  expect((await audioState(page)).paused).toBe(true);
  await page.locator(bar).getByRole('button', { name: 'Play' }).click();
  await expectPlaying(page);
});

test('music keeps playing across page navigation', async ({ page }) => {
  await startPlayback(page);
  // Tag the element: a remount would replace it and stop the music.
  await page.evaluate(() => {
    (document.querySelector('audio') as HTMLAudioElement & { __e2e?: boolean }).__e2e = true;
  });
  for (const name of ['Browse', 'Your library', 'Home']) {
    await page.getByRole('link', { name }).first().click();
    await expectPlaying(page);
  }
  const same = await page.evaluate(
    () => (document.querySelector('audio') as HTMLAudioElement & { __e2e?: boolean }).__e2e === true
  );
  expect(same).toBe(true);
});

test('seeking moves the playhead and playback carries on', async ({ page }) => {
  await startPlayback(page);
  const before = (await audioState(page)).time;
  const slider = page.locator(bar).getByLabel('Playback progress');
  await slider.focus();
  for (let i = 0; i < 6; i++) await slider.press('ArrowRight');
  await slider.blur();
  await expect.poll(async () => (await audioState(page)).time, { timeout: 10_000 }).toBeGreaterThan(before + 10);
  // Invariant 3: seek pauses, then always resumes.
  await expectPlaying(page);
});

test('the full player opens with lyrics and closes again', async ({ page }) => {
  const errors = collectPageErrors(page);
  await startPlayback(page);
  await page.locator(bar).getByRole('button', { name: 'View player' }).click();
  const player = page.getByRole('dialog', { name: 'Now playing' });
  await expect(player).toBeVisible();
  await expect(player.getByRole('tab', { name: 'Lyrics' })).toBeVisible();
  await player.getByRole('tab', { name: 'Up next' }).click();
  await page.keyboard.press('Escape');
  await expect(player).toBeHidden();
  await expectPlaying(page);
  expect(errors).toEqual([]);
});
