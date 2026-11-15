import React, { useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BrowseStackParamList } from '../types/navigation';
import { catalogRequest, loadAlbum, searchAlbums } from '../services/search/catalogSearch';
import { resolveSongAlbum } from '../services/search/songAlbum';
import { DiscoveryCollection } from '../components/stream/DiscoveryCollection';
import { plainErrorMessage } from '../utils/plainError';

export default function CatalogAlbumScreen({ route, navigation }: NativeStackScreenProps<BrowseStackParamList, 'CatalogAlbum'>) {
  const [album, setAlbum] = useState<Awaited<ReturnType<typeof loadAlbum>> | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const { id, songRef, album: albumName, artist } = route.params;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(undefined); setAlbum(null);
    void (async () => {
      const resolved = await resolveSongAlbum({ id, songRef, album: albumName, artist }, {
        song: ref => catalogRequest(`/api/songs/${encodeURIComponent(ref)}`, controller.signal),
        search: query => searchAlbums(query, controller.signal),
      });
      if (!resolved) throw new Error('The original album is not available for this song yet.');
      const value = await loadAlbum(resolved, controller.signal);
      if (!controller.signal.aborted) setAlbum(value);
    })().catch(reason => {
      if (!controller.signal.aborted) setError(plainErrorMessage(reason, 'Could not load this album. Try again.'));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, songRef, albumName, artist, attempt]);
  return <DiscoveryCollection title={album?.title ?? albumName ?? 'Album'} subtitle={album?.artist ?? artist ?? ''}
    artwork={album?.artwork} songs={album?.songs ?? []} loading={loading} error={error} catalogDownload
    onBack={() => navigation.goBack()} onRefresh={() => setAttempt(n => n + 1)} />;
}
