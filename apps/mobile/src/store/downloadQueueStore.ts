import { create } from 'zustand';
import { UnifiedSong } from '../types/song';
import { downloadManager } from '../services/DownloadManager';

// Per-item throttle for progress-only store writes — max 4/sec (250ms)
const PROGRESS_THROTTLE_MS = 250;
const progressThrottleMap = new Map<string, number>();

export interface QueueItem {
  id: string; // song ID
  song: UnifiedSong;
  status: 'pending' | 'staging' | 'downloading' | 'completed' | 'failed' | 'paused';
  progress: number;
  stageStatus?: string; // e.g. "Fetching Lyrics...", "Downloading Audio..."
  error?: string;
  targetPlaylistId?: string;
  sortOrder?: number;
}

interface DownloadQueueStore {
  queue: QueueItem[];
  isProcessing: boolean;

  addToQueue: (songs: UnifiedSong[], targetPlaylistId?: string, sortOrders?: number[]) => void;
  updateItem: (id: string, updates: Partial<QueueItem>) => void;
  removeItem: (id: string) => void;
  clearCompleted: () => void;
  setProcessing: (isProcessing: boolean) => void;

  pauseItem: (id: string) => void;
  resumeItem: (id: string) => void;
  retryItem: (id: string) => void;

  hydrateFromDb: () => Promise<void>;
}

export const useDownloadQueueStore = create<DownloadQueueStore>((set) => ({
  queue: [],
  isProcessing: false,

  addToQueue: (songs: UnifiedSong[], targetPlaylistId?: string, sortOrders?: number[]) => {
    set(state => {
      const newItems = songs
        .filter(s => !state.queue.find(q => q.id === s.id))
        .map((s, index) => ({
          id: s.id,
          song: s,
          status: 'pending' as const,
          progress: 0,
          stageStatus: 'Waiting...',
          targetPlaylistId,
          sortOrder: sortOrders ? sortOrders[index] : undefined
        }));

      if (newItems.length > 0) {
        import('../database/downloadQueueQueries').then(m => {
          newItems.forEach(item => m.insertJob(item).catch(() => {}));
        }).catch(() => {});
      }

      return {
        queue: [...state.queue, ...newItems]
      };
    });
  },

  updateItem: (id: string, updates: Partial<QueueItem>) => {
    // Throttle progress-only writes to max 4/sec to prevent flooding the store
    const keys = Object.keys(updates);
    if (keys.length === 1 && keys[0] === 'progress') {
      const now = Date.now();
      const last = progressThrottleMap.get(id) ?? 0;
      if (now - last < PROGRESS_THROTTLE_MS) return;
      progressThrottleMap.set(id, now);
    }

    // Persist status transitions — completed jobs are deleted, others updated
    if (updates.status) {
      import('../database/downloadQueueQueries').then(m => {
        if (updates.status === 'completed') {
          m.deleteJob(id).catch(() => {});
        } else {
          m.updateJobStatus(id, updates.status!, updates.error).catch(() => {});
        }
      }).catch(() => {});
    }

    set(state => ({
      queue: state.queue.map(item => item.id === id ? { ...item, ...updates } : item)
    }));
  },

  removeItem: (id: string) => {
    progressThrottleMap.delete(id);
    import('../database/downloadQueueQueries').then(m => m.deleteJob(id)).catch(() => {});
    set(state => ({
      queue: state.queue.filter(item => item.id !== id)
    }));
  },

  clearCompleted: () => {
    import('../database/downloadQueueQueries').then(m => m.deleteCompletedJobs()).catch(() => {});
    set(state => ({
      queue: state.queue.filter(item => item.status !== 'completed')
    }));
  },

  setProcessing: (isProcessing: boolean) => set({ isProcessing }),

  pauseItem: (id: string) => {
    downloadManager.pauseDownload(id);
    import('../database/downloadQueueQueries').then(m => m.updateJobStatus(id, 'paused')).catch(() => {});
    set(state => ({
      queue: state.queue.map(item =>
        item.id === id ? { ...item, status: 'paused', stageStatus: 'Paused' } : item
      )
    }));
  },

  resumeItem: (id: string) => {
    downloadManager.resumeDownload(id);
    import('../database/downloadQueueQueries').then(m => m.updateJobStatus(id, 'pending')).catch(() => {});
    set(state => ({
      queue: state.queue.map(item =>
        item.id === id ? { ...item, status: 'pending', stageStatus: 'Resuming...' } : item
      )
    }));
  },

  retryItem: (id: string) => {
    import('../database/downloadQueueQueries').then(m => m.updateJobStatus(id, 'pending')).catch(() => {});
    set(state => ({
      queue: state.queue.map(item =>
        item.id === id ? { ...item, status: 'pending', progress: 0, stageStatus: 'Retrying...' } : item
      )
    }));
  },

  hydrateFromDb: async () => {
    try {
      const { loadAllJobs } = await import('../database/downloadQueueQueries');
      const jobs = await loadAllJobs();
      if (jobs.length > 0) {
        set(state => ({
          queue: [
            ...jobs.filter(j => !state.queue.find(q => q.id === j.id)),
            ...state.queue,
          ]
        }));
      }
    } catch (e) {
      if (__DEV__) console.warn('[DownloadQueueStore] hydrateFromDb failed:', e);
    }
  },
}));
