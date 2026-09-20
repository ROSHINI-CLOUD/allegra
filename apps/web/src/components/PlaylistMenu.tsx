import { Check, ListPlus, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import type { UnifiedSong } from '@shared/types';

import { usePlaylistsContext } from '../hooks/usePlaylists';
import { IconButton, TactileButton } from './ui';

/**
 * A button that opens a small sheet for saving one song into playlists. It is a
 * centred sheet rather than a popover so no list row or scroll container can clip it.
 */
export function PlaylistMenu({ song }: { readonly song: UnifiedSong }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const { playlists, actionError, create, toggleSong } = usePlaylistsContext();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    // Capture phase, so Escape closes only this sheet and not the player behind it.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    const library = await create(name);
    if (library) {
      setName('');
      await toggleSong(library.id, song);
    }
    setBusy(false);
  };

  return (
    <>
      <IconButton icon={ListPlus} label={`Save ${song.title} to a playlist`} onClick={() => setOpen(true)} />
      {open ? (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="playlist-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
            <div className="playlist-sheet-head">
              <div>
                <h2 id={titleId}>Save to playlist</h2>
                <p title={song.title}>{song.title}</p>
              </div>
              <button ref={closeRef} type="button" className="icon-button" aria-label="Close" onClick={() => setOpen(false)}><X size={18} aria-hidden="true" /></button>
            </div>
            {playlists.length > 0 ? (
              <ul className="playlist-choices">
                {playlists.map((playlist) => {
                  const included = playlist.songIds.includes(song.id);
                  return (
                    <li key={playlist.id}>
                      <button type="button" role="checkbox" aria-checked={included} className={`playlist-choice ${included ? 'is-included' : ''}`} onClick={() => void toggleSong(playlist.id, song)}>
                        <span className="playlist-check" aria-hidden="true">{included ? <Check size={14} /> : null}</span>
                        <span className="playlist-choice-name">{playlist.name}</span>
                        <span className="playlist-choice-count">{playlist.songIds.length}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="playlist-empty">No playlists yet. Name your first one below.</p>}
            <form className="playlist-new" onSubmit={(event) => void submit(event)}>
              <label className="sr-only" htmlFor={`${titleId}-name`}>New playlist name</label>
              <input id={`${titleId}-name`} value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="New playlist name" autoComplete="off" />
              <TactileButton type="submit" variant="primary" icon={Plus} disabled={busy || !name.trim()}>Create and add</TactileButton>
            </form>
            {actionError ? <p className="playlist-error" role="alert">{actionError}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
