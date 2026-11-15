/**
 * LyricFlow - SQLite Database Initialization
 */

import * as SQLite from 'expo-sqlite';

// export { migratePlaylistData } from './db_migration'; // MOVED to direct import in App.tsx to break require cycle

const DATABASE_NAME = 'lyricflow.db';
const LOG_PREFIX = '[DB]';

let db: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let isInitialized = false;

const log = (msg: string, data?: any) => {
  if (__DEV__) console.log(`${LOG_PREFIX} ${msg}`, data ?? '');
};

const openAndInitialize = async (): Promise<SQLite.SQLiteDatabase> => {
  log('Opening database...');
  const dbInstance = await SQLite.openDatabaseAsync(DATABASE_NAME);
  log('Database opened, initializing tables...');
  await initializeTables(dbInstance);
  log('Tables initialized successfully');
  return dbInstance;
};

/**
 * Initialize and return database instance - STRICT SINGLETON
 */
export const getDatabase = async (): Promise<SQLite.SQLiteDatabase> => {
  // Return existing initialized instance
  if (isInitialized && db) {
    return db;
  }

  // Wait for in-progress initialization
  if (initPromise !== null) {
    log('Waiting for in-progress initialization...');
    return initPromise;
  }

  // Start new initialization
  log('Starting new database initialization...');
  initPromise = (async () => {
    try {
      // Clean slate: close any stale handles
      if (db) {
        log('Closing stale database handle...');
        try {
          await db.closeAsync();
        } catch (e) {
          log('Failed to close stale handle (expected)', e);
        }
        db = null;
      }

      const dbInstance = await openAndInitialize();
      db = dbInstance;
      isInitialized = true;
      log('Database ready');
      return dbInstance;
    } catch (error) {
      log('Initialization failed, attempting recovery...', error);
      
      // Recovery: delete and recreate
      try {
        if (db) {
          await db.closeAsync().catch(() => {});
          db = null;
        }
        
        log('Deleting corrupted database...');
        await SQLite.deleteDatabaseAsync(DATABASE_NAME);
        
        log('Recreating database...');
        const recoveredDb = await openAndInitialize();
        db = recoveredDb;
        isInitialized = true;
        log('Database recovered successfully');
        return recoveredDb;
      } catch (recoveryError) {
        log('Recovery failed', recoveryError);
        db = null;
        isInitialized = false;
        throw error;
      }
    } finally {
      initPromise = null;
    }
  })();
  
  return initPromise;
};

/**
 * Initialize database - entry point for app startup
 */
export const initDatabase = async (): Promise<void> => {
  log('initDatabase() called');
  await getDatabase();
  log('initDatabase() completed');
};

/**
 * Create tables if they don't exist
 */
const initializeTables = async (database: SQLite.SQLiteDatabase): Promise<void> => {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    
    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT,
      album TEXT,
      gradient_id TEXT NOT NULL,
      duration INTEGER DEFAULT 0,
      date_created TEXT NOT NULL,
      date_modified TEXT NOT NULL,
      play_count INTEGER DEFAULT 0,
      last_played TEXT,
      scroll_speed INTEGER DEFAULT 50,
      cover_image_uri TEXT,
      lyrics_align TEXT DEFAULT 'left',
      audio_uri TEXT,
      is_hidden INTEGER DEFAULT 0
    );
    
    CREATE TABLE IF NOT EXISTS lyrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      text TEXT NOT NULL,
      line_order INTEGER NOT NULL,
      FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS generated_playlists (
      scope TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      cover_image_uri TEXT,
      is_default INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      date_created TEXT NOT NULL,
      date_modified TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS playlist_songs (
      playlist_id TEXT NOT NULL,
      song_id TEXT NOT NULL,
      added_at TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      PRIMARY KEY (playlist_id, song_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
    );
    
    CREATE TABLE IF NOT EXISTS download_jobs (
      id TEXT PRIMARY KEY,
      song_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      progress REAL DEFAULT 0,
      target_playlist_id TEXT,
      sort_order INTEGER DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lyrics_scan_jobs (
      song_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      is_forced_synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Library sync with the Allegra account (services/sync). Songs liked or added to a playlist
    -- on another device that are not downloaded here: a like is not a download.
    CREATE TABLE IF NOT EXISTS liked_online_songs (
      ref TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT,
      album TEXT,
      artwork TEXT,
      duration REAL NOT NULL DEFAULT 0,
      liked_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_online_songs (
      playlist_id TEXT NOT NULL,
      ref TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT,
      album TEXT,
      artwork TEXT,
      duration REAL NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, ref),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    );

    -- Changes made here that the account has not seen yet, oldest first, and the sync cursor.
    CREATE TABLE IF NOT EXISTS sync_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      account_user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Listening stats (1.45.0): every listen heard on this phone, signed in or not. Stays on the phone.
    CREATE TABLE IF NOT EXISTS listen_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_key TEXT NOT NULL,
      song_id TEXT NOT NULL,
      ref TEXT,
      title TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      album TEXT,
      artwork TEXT,
      duration_sec REAL NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      heard_sec REAL NOT NULL,
      exit TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_listen_log_started ON listen_log(started_at);

    -- Optional ListenBrainz copy of the history: listens waiting to be sent with the listener's own token.
    CREATE TABLE IF NOT EXISTS listenbrainz_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listened_at INTEGER NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      duration_sec REAL NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_listenbrainz_queue_listen ON listenbrainz_queue(listened_at, title, artist);

    -- A song's tempo, found once (Deezer's catalogue or measured on the phone) and kept.
    CREATE TABLE IF NOT EXISTS song_tempo (
      song_key TEXT PRIMARY KEY,
      bpm REAL,
      source TEXT NOT NULL,
      checked_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
    CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
    CREATE INDEX IF NOT EXISTS idx_lyrics_song_id ON lyrics(song_id);
    CREATE INDEX IF NOT EXISTS idx_lyrics_timestamp ON lyrics(timestamp);
    CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist ON playlist_songs(playlist_id, sort_order);

    -- The order a listener dragged a playlist into, for every row it shows: downloaded songs and songs that are
    -- only in the account (playlist_online_songs has no position, so those snapped back after a reorder).
    CREATE TABLE IF NOT EXISTS playlist_item_order (
      playlist_id TEXT NOT NULL,
      song_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (playlist_id, song_id)
    );

    -- Seed default playlist
    INSERT OR IGNORE INTO playlists (id, name, description, is_default, sort_order, date_created, date_modified)
    VALUES ('default_liked', 'Liked Songs', 'Your favorite tracks', 1, -1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  `);
  
  // Migration: Add lyrics_align if missing
  try {
    const outboxColumns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(sync_outbox)');
    if (!outboxColumns.some(c => c.name === 'account_user_id')) {
      // Existing rows cannot be attributed safely after the fact. NULL means quarantined:
      // they remain on-device but never sync to whichever account signs in next.
      await database.execAsync('ALTER TABLE sync_outbox ADD COLUMN account_user_id TEXT');
    }
    // Single quotes: a double-quoted "play" is an identifier, and builds without DQS reject it.
    await database.execAsync("CREATE INDEX IF NOT EXISTS idx_sync_outbox_play_owner ON sync_outbox(account_user_id, id) WHERE kind = 'play'");

    const columns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(songs)');
    if (!columns.some(c => c.name === 'lyrics_align')) {
      log('Adding lyrics_align column...');
      await database.execAsync('ALTER TABLE songs ADD COLUMN lyrics_align TEXT DEFAULT "left"');
      log('Migration complete');
    }
    if (!columns.some(c => c.name === 'text_case')) {
      log('Adding text_case column...');
      await database.execAsync('ALTER TABLE songs ADD COLUMN text_case TEXT DEFAULT "normal"');
      log('Migration complete');
    }
    if (!columns.some(c => c.name === 'audio_uri')) {
      log('Adding audio_uri column...');
      await database.execAsync('ALTER TABLE songs ADD COLUMN audio_uri TEXT');
      log('Migration complete');
    }
    if (!columns.some(c => c.name === 'is_liked')) {
      log('Adding is_liked column...');
      await database.execAsync('ALTER TABLE songs ADD COLUMN is_liked INTEGER DEFAULT 0');
      log('Migration complete');
    }
    // AI Karaoke: Stem storage columns
    if (!columns.some(c => c.name === 'vocal_stem_uri')) {
      log('Adding vocal_stem_uri column...');
      await database.execAsync('ALTER TABLE songs ADD COLUMN vocal_stem_uri TEXT');
      log('Migration complete');
    }
    if (!columns.some(c => c.name === 'instrumental_stem_uri')) {
      log('Adding instrumental_stem_uri column...');
      await database.execAsync('ALTER TABLE songs ADD COLUMN instrumental_stem_uri TEXT');
      log('Migration complete');
    }
    if (!columns.some(c => c.name === 'separation_status')) {
      log('Adding separation_status column...');
      await database.execAsync('ALTER TABLE songs ADD COLUMN separation_status TEXT DEFAULT "none"');
      log('Migration complete');
    }
    if (!columns.some(c => c.name === 'separation_progress')) {
      log('Adding separation_progress column...');
      await database.execAsync('ALTER TABLE songs ADD COLUMN separation_progress INTEGER DEFAULT 0');
      log('Migration complete');
    }
    if (!columns.some(c => c.name === 'is_hidden')) {
      log('Adding is_hidden column...');
      // Retry logic for locked database
      let retries = 3;
      while (retries > 0) {
        try {
          await database.execAsync('ALTER TABLE songs ADD COLUMN is_hidden INTEGER DEFAULT 0');
          log('Migration complete');
          break;
        } catch (e) {
          if (retries === 1) throw e; // Throw on last attempt
          log(`Migration failed (locked?), retrying in 500ms... (${retries} left)`, e);
          await new Promise(resolve => setTimeout(resolve, 500));
          retries--;
        }
      }
    }
    if (!columns.some(c => c.name === 'youtube_video_id')) {
      log('Adding youtube_video_id column...');
      await database.execAsync('ALTER TABLE songs ADD COLUMN youtube_video_id TEXT');
      log('Migration complete');
    }
    // Connect / library sync: which catalog song a download came from (packages/shared/songRef).
    if (!columns.some(c => c.name === 'origin_id')) {
      log('Adding origin_id column...');
      await database.execAsync('ALTER TABLE songs ADD COLUMN origin_id TEXT');
      log('Migration complete');
    }
    await database.execAsync('CREATE INDEX IF NOT EXISTS idx_songs_origin_id ON songs(origin_id)');
    // Connect: the catalog's https cover beside a download's local cover file, which no other
    // device can open, and when the catalog was last asked about a song that has neither yet.
    if (!columns.some(c => c.name === 'cover_remote_uri')) {
      log('Adding cover_remote_uri column...');
      await database.execAsync('ALTER TABLE songs ADD COLUMN cover_remote_uri TEXT');
      log('Migration complete');
    }
    if (!columns.some(c => c.name === 'catalog_checked_at')) {
      log('Adding catalog_checked_at column...');
      await database.execAsync('ALTER TABLE songs ADD COLUMN catalog_checked_at INTEGER');
      log('Migration complete');
    }
    // 1.41.0: a song saved only so a downloaded playlist plays offline. It lives on the phone but stays out of the
    // Library's song list; saving it yourself later turns the flag off instead of downloading it again.
    if (!columns.some(c => c.name === 'playlist_only')) {
      log('Adding playlist_only column...');
      await database.execAsync('ALTER TABLE songs ADD COLUMN playlist_only INTEGER DEFAULT 0');
      log('Migration complete');
    }
    // A queued download keeps whether it is only for a playlist, so a restart doesn't put it in the Library list.
    const jobColumns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(download_jobs)');
    if (!jobColumns.some(c => c.name === 'playlist_only')) {
      await database.execAsync('ALTER TABLE download_jobs ADD COLUMN playlist_only INTEGER DEFAULT 0');
    }
    // Word-synced lyrics: each line's word timings as JSON (`LyricWord[]`), null for a line-synced line.
    const lyricColumns = await database.getAllAsync<{ name: string }>('PRAGMA table_info(lyrics)');
    if (!lyricColumns.some(c => c.name === 'words')) {
      log('Adding lyrics.words column...');
      await database.execAsync('ALTER TABLE lyrics ADD COLUMN words TEXT');
      log('Migration complete');
    }
  } catch (e) {
    log('Migration check failed', e);
    throw e; // RETHROW to ensure init fails if schema is broken
  }
};

/**
 * Close database connection
 */
export const closeDatabase = async (): Promise<void> => {
  log('closeDatabase() called');
  
  if (initPromise !== null) {
    log('Waiting for init to complete before closing...');
    await initPromise.catch(() => undefined);
  }

  if (db) {
    log('Closing database...');
    await db.closeAsync();
    db = null;
    isInitialized = false;
    log('Database closed');
  }

  initPromise = null;
};

// ==========================================
// SHARED DB HELPERS
// ==========================================

export const isNativeDbNullPointer = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return /NativeDatabase\.(prepareAsync|execAsync)|NullPointerException/i.test(error.message);
};

export const withDbRetry = async <T>(operation: (db: Awaited<ReturnType<typeof getDatabase>>) => Promise<T>): Promise<T> => {
  try {
    const database = await getDatabase();
    return await operation(database);
  } catch (error) {
    log('Operation failed', error);
    
    if (!isNativeDbNullPointer(error)) {
      throw error;
    }

    log('Detected native NPE, attempting recovery...');
    await closeDatabase().catch(() => undefined);
    await initDatabase();
    const recoveredDb = await getDatabase();
    log('Retrying operation after recovery...');
    return operation(recoveredDb);
  }
};

let dbOperationQueue: Promise<void> = Promise.resolve();

const withSerializedDbAccess = async <T>(operation: () => Promise<T>): Promise<T> => {
  const result = dbOperationQueue.then(operation);
  // Append catch to ensure queue continues even if op fails
  dbOperationQueue = result.then(() => {}).catch(() => {});
  return result;
};

// READS can be parallel (mostly), but WRITES must be serialized
export const withDbRead = async <T>(operation: (db: Awaited<ReturnType<typeof getDatabase>>) => Promise<T>): Promise<T> => {
    return withDbRetry(operation);
};

export const withDbWrite = async <T>(operation: (db: Awaited<ReturnType<typeof getDatabase>>) => Promise<T>): Promise<T> => {
  return withSerializedDbAccess(() => withDbRetry(operation));
};

// ALIAS: For backward compatibility with other query functions not yet updated
export const withDbSafe = withDbWrite;


export const esc = (val: string) => val.replace(/'/g, "''");

