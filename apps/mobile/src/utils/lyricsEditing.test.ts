import { type EditorDraft, formatOffset, hasTimestamps, hasUnsavedEdits, parseDurationInput, shiftTimestamps } from './lyricsEditing';

describe('shiftTimestamps', () => {
  it('moves every stamp and keeps the words', () => {
    expect(shiftTimestamps('[0:05.00]Hello\n[1:02.50]World', 1.5)).toBe('[0:06.50]Hello\n[1:04.00]World');
  });

  it('carries across a minute', () => {
    expect(shiftTimestamps('[0:59.60]Line', 0.5)).toBe('[1:00.10]Line');
  });

  it('never goes below zero', () => {
    expect(shiftTimestamps('[0:00.30]Start', -1)).toBe('[0:00.00]Start');
  });

  it('leaves plain lines alone', () => {
    expect(shiftTimestamps('Verse one\n[0:10.00]Sung', -0.1)).toBe('Verse one\n[0:09.90]Sung');
  });
});

describe('hasTimestamps', () => {
  it('spots synced lyrics', () => {
    expect(hasTimestamps('intro\n[0:12.00]line')).toBe(true);
    expect(hasTimestamps('just words\nmore words')).toBe(false);
  });
});

describe('parseDurationInput', () => {
  it('reads minutes and seconds or plain seconds', () => {
    expect(parseDurationInput('3:25')).toBe(205);
    expect(parseDurationInput('90')).toBe(90);
    expect(parseDurationInput('soon')).toBe(0);
  });
});

describe('formatOffset', () => {
  it('shows the running shift with a sign', () => {
    expect(formatOffset(0.6000001)).toBe('+0.6s');
    expect(formatOffset(-1.5)).toBe('−1.5s');
    expect(formatOffset(0)).toBe('0s');
  });
});

describe('hasUnsavedEdits', () => {
  const loaded: EditorDraft = { title: 'Tum Hi Ho', artist: 'Arijit Singh', album: '', lyrics: '[0:05.00]Hello', transliteration: '', duration: '4:22', align: 'left' };

  it('is false before the song loads and while nothing changed', () => {
    expect(hasUnsavedEdits(null, loaded)).toBe(false);
    expect(hasUnsavedEdits(loaded, { ...loaded })).toBe(false);
  });

  it('is true for any edited field, including a lyric shift and the alignment', () => {
    expect(hasUnsavedEdits(loaded, { ...loaded, title: 'Tum Hi Ho (Film)' })).toBe(true);
    expect(hasUnsavedEdits(loaded, { ...loaded, lyrics: '[0:06.00]Hello' })).toBe(true);
    expect(hasUnsavedEdits(loaded, { ...loaded, align: 'center' })).toBe(true);
  });
});
