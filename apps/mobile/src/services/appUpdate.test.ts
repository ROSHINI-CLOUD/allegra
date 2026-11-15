import { buildFromAssets, CHANGELOG_URL, checkedAgo, fetchLatestBuild, fetchReleaseHistory, formatSize, latestReleaseNotes, LATEST_APK_URL, NO_NOTES, notesFromBody, parseChangelog, parseRelease, parseReleaseHistory, releasedAgo, shouldAutoCheck, standingOf, UPDATE_HISTORY_URL, type LatestBuild } from './appUpdate';

describe('parseRelease', () => {
  it('reads the date and the APK from a release', () => {
    const build = parseRelease({
      published_at: '2026-09-27T18:49:06Z',
      assets: [
        { name: 'notes.txt', browser_download_url: 'https://example.com/notes.txt' },
        { name: 'LuvLyrics.apk', browser_download_url: 'https://example.com/LuvLyrics.apk' },
      ],
    });
    expect(build?.publishedAt.toISOString()).toBe('2026-09-27T18:49:06.000Z');
    expect(build?.downloadUrl).toBe('https://example.com/LuvLyrics.apk');
  });

  it('offers LuvLyrics itself, never the island add-on listed beside it', () => {
    const build = parseRelease({
      published_at: '2026-09-27T18:49:06Z',
      assets: [
        { name: 'LuvLyricsIsland.apk', size: 1_000, browser_download_url: 'https://example.com/LuvLyricsIsland.apk' },
        { name: 'LuvLyrics.apk', size: 60_000_000, browser_download_url: 'https://example.com/LuvLyrics.apk' },
      ],
    });
    expect(build?.downloadUrl).toBe('https://example.com/LuvLyrics.apk');
    expect(build?.sizeBytes).toBe(60_000_000);
    expect(parseRelease({ published_at: '2026-09-27T18:49:06Z', assets: [{ name: 'LuvLyricsIsland.apk', browser_download_url: 'https://example.com/i.apk' }] })?.downloadUrl).toBe(LATEST_APK_URL);
  });

  it('falls back to the stable download link when the release lists no APK', () => {
    expect(parseRelease({ published_at: '2026-09-27T18:49:06Z', assets: [] })?.downloadUrl).toBe(LATEST_APK_URL);
  });

  it('has nothing to offer without a usable date', () => {
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease({})).toBeNull();
    expect(parseRelease({ published_at: 'not a date' })).toBeNull();
  });
});

describe('releasedAgo', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  it('says today, yesterday and a few days ago in words', () => {
    expect(releasedAgo(new Date('2026-09-29T08:00:00Z'), now)).toBe('today');
    expect(releasedAgo(new Date('2026-09-28T08:00:00Z'), now)).toBe('yesterday');
    expect(releasedAgo(new Date('2026-09-25T08:00:00Z'), now)).toBe('4 days ago');
  });
});

describe('release commit', () => {
  it('reads the commit the release was built from', () => {
    const sha = 'A8577AFE8904ACD4CDF191765C208C8EA7DEA455';
    expect(parseRelease({ published_at: '2026-09-30T08:02:11Z', target_commitish: sha })?.commit).toBe(sha.toLowerCase());
  });

  it('ignores a branch name in place of a commit', () => {
    expect(parseRelease({ published_at: '2026-09-30T08:02:11Z', target_commitish: 'main' })?.commit).toBeNull();
  });
});

describe('standingOf', () => {
  const sha = 'a8577afe8904acd4cdf191765c208c8ea7dea455';
  const release = (publishedAt: string, commit: string | null = null): LatestBuild =>
    ({ publishedAt: new Date(publishedAt), downloadUrl: LATEST_APK_URL, commit, sizeBytes: null, version: null, changelogUrl: null, notes: NO_NOTES });

  it('knows the release is the build already installed', () => {
    expect(standingOf(release('2026-10-01T12:05:00Z', sha), { commit: sha, builtAt: new Date('2026-10-01T12:00:00Z') })).toBe('current');
  });

  it('never offers a main release from before a newer feature-branch build', () => {
    // The phone runs a feature build from today; apk-latest is yesterday's main build.
    expect(standingOf(release('2026-09-30T08:02:11Z', 'b'.repeat(40)), { commit: sha, builtAt: new Date('2026-10-01T10:56:37Z') })).toBe('older');
  });

  it('offers a main release published after this build', () => {
    expect(standingOf(release('2026-10-02T09:00:00Z', 'c'.repeat(40)), { commit: sha, builtAt: new Date('2026-10-01T10:56:37Z') })).toBe('update');
  });

  it('offers the release when nothing is known about this build', () => {
    expect(standingOf(release('2026-09-30T08:02:11Z'), { commit: null, builtAt: null })).toBe('update');
  });

  it('keeps the latest release notes when the phone already has that exact build', () => {
    const latest: LatestBuild = {
      publishedAt: new Date('2026-10-02T09:00:00Z'),
      downloadUrl: LATEST_APK_URL,
      commit: sha,
      sizeBytes: null,
      version: '1.65.0',
      changelogUrl: null,
      notes: { description: null, sections: [{ title: 'New', items: ['Lyrics without a provider key'] }] },
    };
    expect(standingOf(latest, { commit: sha, builtAt: latest.publishedAt })).toBe('current');
    expect(latestReleaseNotes(latest)).toEqual(latest.notes);
  });
});

describe('release size, version and changelog file', () => {
  const release = {
    name: 'LuvLyrics 0.2.0 — latest build',
    published_at: '2026-10-01T16:51:09Z',
    assets: [
      { name: 'LuvLyrics.apk', size: 64_800_000, browser_download_url: 'https://example.com/LuvLyrics.apk' },
      { name: 'changelog.json', size: 400, browser_download_url: 'https://example.com/changelog.json' },
    ],
  };

  it('reads the APK size, the version from the title and the changelog file', () => {
    const build = parseRelease(release);
    expect(build?.sizeBytes).toBe(64_800_000);
    expect(build?.version).toBe('0.2.0');
    expect(build?.changelogUrl).toBe('https://example.com/changelog.json');
  });

  it('copes with a release that has none of them', () => {
    const build = parseRelease({ published_at: '2026-10-01T16:51:09Z', name: 'LuvLyrics — latest build' });
    expect(build).toMatchObject({ sizeBytes: null, version: null, changelogUrl: null });
    expect(build?.notes).toEqual(NO_NOTES);
  });
});

describe('formatSize', () => {
  it('speaks in megabytes the way a download list does', () => {
    expect(formatSize(64_800_000)).toBe('61.8 MB');
    expect(formatSize(150 * 1024 * 1024)).toBe('150 MB');
    expect(formatSize(300 * 1024)).toBe('300 KB');
  });
});

describe('parseChangelog', () => {
  it('reads the sections and the description', () => {
    expect(parseChangelog({
      description: ' A big one. ',
      changelog: [{ title: 'New', items: ['Queue editing', ' Goodbye '] }, { title: 'Fixed', items: ['Seek'] }],
    })).toEqual({
      description: 'A big one.',
      sections: [{ title: 'New', items: ['Queue editing', 'Goodbye'] }, { title: 'Fixed', items: ['Seek'] }],
    });
  });

  it('skips what is not a section and refuses what is not a changelog', () => {
    expect(parseChangelog({ changelog: [{ title: 'New', items: [] }, { title: 3, items: ['x'] }, null, { title: 'Fixed', items: ['Seek', 4, ''] }] }))
      .toEqual({ description: null, sections: [{ title: 'Fixed', items: ['Seek'] }] });
    expect(parseChangelog(null)).toBeNull();
    expect(parseChangelog({ description: 'x' })).toBeNull();
    expect(parseChangelog('nope')).toBeNull();
  });
});

describe('parseReleaseHistory', () => {
  const entry = (version: string, item: string) => ({ version, description: null, changelog: [{ title: 'New', items: [item] }] });

  it('reads at most four recent versions in newest-first order', () => {
    expect(parseReleaseHistory({ entries: [
      entry('1.66.0', 'See recent updates in Stream.'),
      entry('1.65.0', 'Find lyrics for more versions of a song.'),
      { version: '1.64.5', description: 'This release included no visible changes in the Android app.', changelog: [] },
      entry('1.64.3', 'Download a song again after removing it.'),
      entry('1.64.2', 'Oldest retained version.'),
    ] })).toEqual([
      { version: '1.66.0', notes: { description: null, sections: [{ title: 'New', items: ['See recent updates in Stream.'] }] } },
      { version: '1.65.0', notes: { description: null, sections: [{ title: 'New', items: ['Find lyrics for more versions of a song.'] }] } },
      { version: '1.64.5', notes: { description: 'This release included no visible changes in the Android app.', sections: [] } },
      { version: '1.64.3', notes: { description: null, sections: [{ title: 'New', items: ['Download a song again after removing it.'] }] } },
    ]);
  });

  it('skips invalid and duplicate versions and rejects an empty history', () => {
    expect(parseReleaseHistory({ entries: [
      entry('latest', 'Do not guess a version.'),
      entry('1.66.0', 'A clear update.'),
      entry('1.66.0', 'Do not show a duplicate.'),
    ] })).toHaveLength(1);
    expect(parseReleaseHistory({ entries: [] })).toBeNull();
    expect(parseReleaseHistory(null)).toBeNull();
  });

  it('offers rollback only for the matching retained APK asset', () => {
    const history = parseReleaseHistory({ entries: [
      entry('1.66.0', 'Latest.'),
      { ...entry('1.65.0', 'Earlier.'), rollbackUrl: 'https://github.com/peterish8/allegra/releases/download/apk-latest/LuvLyrics-rollback-1.65.0.apk' },
      { ...entry('1.64.5', 'Older.'), rollbackUrl: 'https://example.com/LuvLyrics-rollback-1.64.5.apk' },
      { ...entry('1.64.3', 'Oldest.'), rollbackUrl: 'https://github.com/peterish8/allegra/releases/download/apk-latest/LuvLyrics-rollback-1.64.5.apk' },
    ] });
    expect(history?.[1].rollbackUrl).toBe('https://github.com/peterish8/allegra/releases/download/apk-latest/LuvLyrics-rollback-1.65.0.apk');
    expect(history?.[2].rollbackUrl).toBeUndefined();
    expect(history?.[3].rollbackUrl).toBeUndefined();
  });
});

describe('notesFromBody', () => {
  it('turns a release text into sections, leaving out its title and footer', () => {
    const body = [
      '# LuvLyrics 0.2.0', '', '## New', '- Queue editing', '- Goodbye', '', '## Fixed', '* Seek', '',
      'Built from `main` at 417a62c. Download LuvLyrics.apk below.', 'Direct link: https://example.com/LuvLyrics.apk',
    ].join('\r\n');
    expect(notesFromBody(body)).toEqual({
      description: null,
      sections: [{ title: 'New', items: ['Queue editing', 'Goodbye'] }, { title: 'Fixed', items: ['Seek'] }],
    });
  });

  it('keeps plain text before the first heading as the description', () => {
    expect(notesFromBody('Small improvements and fixes.\n\n## Fixed\n- Seek').description).toBe('Small improvements and fixes.');
    expect(notesFromBody('')).toEqual(NO_NOTES);
    expect(notesFromBody(undefined)).toEqual(NO_NOTES);
  });
});

describe('shouldAutoCheck', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('looks when it never has, or when the last look was long ago', () => {
    expect(shouldAutoCheck(null, now)).toBe(true);
    expect(shouldAutoCheck('2026-10-02T05:00:00Z', now)).toBe(true);
    expect(shouldAutoCheck('garbage', now)).toBe(true);
  });
  it('leaves it alone when it looked recently', () => {
    expect(shouldAutoCheck('2026-10-02T09:00:00Z', now)).toBe(false);
  });
});

const COMMIT = 'bf78a9a941054bd84c87a85a7e9aed7184c93f7c';
const CHANGELOG = { version: '1.60.0', commit: COMMIT, description: '', changelog: [{ title: 'New', items: ['One song menu'] }] };

describe('buildFromAssets', () => {
  const when = new Date('2026-11-13T07:08:03Z');

  it('reads the version, commit and notes from changelog.json, and the date and size from the files', () => {
    const build = buildFromAssets(CHANGELOG, when, 64_831_215);
    expect(build).toMatchObject({ version: '1.60.0', commit: COMMIT, sizeBytes: 64_831_215, downloadUrl: LATEST_APK_URL, changelogUrl: CHANGELOG_URL });
    expect(build?.publishedAt).toBe(when);
    expect(build?.notes.sections).toEqual([{ title: 'New', items: ['One song menu'] }]);
  });

  it('keeps an unknown size, version or commit as null instead of guessing', () => {
    const build = buildFromAssets({ version: 'latest', commit: 'main', changelog: [] }, when, null);
    expect(build).toMatchObject({ version: null, commit: null, sizeBytes: null });
  });

  it('has nothing to offer without a date or without a changelog object', () => {
    expect(buildFromAssets(CHANGELOG, null, 1)).toBeNull();
    expect(buildFromAssets(CHANGELOG, new Date('nope'), 1)).toBeNull();
    expect(buildFromAssets(null, when, 1)).toBeNull();
    expect(buildFromAssets('text', when, 1)).toBeNull();
  });
});

describe('fetchLatestBuild', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  const answer = (body: unknown, headers: Record<string, string> = {}, ok = true): Response =>
    ({ ok, status: ok ? 200 : 403, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null }, json: async () => body }) as unknown as Response;

  const serve = (routes: Record<string, () => Response | Promise<Response>>) => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const key = String(url);
      calls.push(key);
      const route = routes[key];
      if (!route) throw new Error(`unexpected ${key}`);
      return route();
    }) as unknown as typeof fetch;
    return calls;
  };

  it('finds the build from the release downloads and never touches the rate-limited API', async () => {
    const calls = serve({
      [CHANGELOG_URL]: () => answer(CHANGELOG, { 'last-modified': 'Fri, 13 Nov 2026 07:08:03 GMT' }),
      [LATEST_APK_URL]: () => answer(null, { 'last-modified': 'Fri, 13 Nov 2026 07:07:50 GMT', 'content-length': '64831215' }),
    });
    const build = await fetchLatestBuild();
    expect(build).toMatchObject({ version: '1.60.0', commit: COMMIT, sizeBytes: 64_831_215 });
    expect(build?.publishedAt.toISOString()).toBe('2026-11-13T07:07:50.000Z');
    expect(calls.some(url => new URL(url).hostname === 'api.github.com')).toBe(false);
  });

  it('still answers when the API is rate limited (403), which used to read as no connection', async () => {
    serve({
      [CHANGELOG_URL]: () => answer(CHANGELOG, { 'last-modified': 'Fri, 13 Nov 2026 07:08:03 GMT' }),
      [LATEST_APK_URL]: () => { throw new Error('HEAD blocked'); },
      'https://api.github.com/repos/peterish8/allegra/releases/tags/apk-latest': () => answer({ message: 'API rate limit exceeded' }, {}, false),
    });
    const build = await fetchLatestBuild();
    expect(build).toMatchObject({ version: '1.60.0', commit: COMMIT, sizeBytes: null });
    expect(build?.publishedAt.toISOString()).toBe('2026-11-13T07:08:03.000Z');
  });

  it('falls back to the API when the download links cannot be read', async () => {
    serve({
      [CHANGELOG_URL]: () => answer(null, {}, false),
      [LATEST_APK_URL]: () => answer(null, {}, false),
      'https://api.github.com/repos/peterish8/allegra/releases/tags/apk-latest': () => answer({ name: 'LuvLyrics 1.61.0 — latest build', published_at: '2026-11-14T08:00:00Z', assets: [] }),
    });
    expect(await fetchLatestBuild()).toMatchObject({ version: '1.61.0' });
  });

  it('is null, not a throw, when nothing can be reached', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await fetchLatestBuild()).toBeNull();
  });
});

describe('fetchReleaseHistory', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('loads the release history from the static asset without a GitHub API call', async () => {
    const entries = [{ version: '1.66.0', description: null, changelog: [{ title: 'New', items: ['See updates in Stream.'] }] }];
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ entries }) } as Response;
    }) as unknown as typeof fetch;

    expect(await fetchReleaseHistory()).toEqual([{ version: '1.66.0', notes: { description: null, sections: [{ title: 'New', items: ['See updates in Stream.'] }] } }]);
    expect(calls).toEqual([UPDATE_HISTORY_URL]);
  });

  it('returns null when the optional asset is not available', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await fetchReleaseHistory()).toBeNull();
  });
});

describe('checkedAgo', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('is exact for the last hour and plain after it', () => {
    expect(checkedAgo(new Date('2026-10-02T11:59:40Z'), now)).toBe('just now');
    expect(checkedAgo(new Date('2026-10-02T11:48:00Z'), now)).toBe('12 min ago');
    expect(checkedAgo(new Date('2026-10-02T08:00:00Z'), now)).toBe('today');
    expect(checkedAgo(new Date('2026-10-01T08:00:00Z'), now)).toBe('yesterday');
  });
});
