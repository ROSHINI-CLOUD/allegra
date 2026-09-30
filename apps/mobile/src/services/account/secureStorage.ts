/**
 * Convex Auth keeps its session (JWT + refresh token) here. React Native has no
 * localStorage, and these are credentials, so they go to the OS keystore.
 * SecureStore keys may only hold letters, digits, ".", "-" and "_"; Convex Auth
 * already strips other characters from its namespace, this guards the rest.
 *
 * The manifest keeps these entries out of Android backups (secure_store_* rules,
 * which the expo-secure-store config plugin would add on prebuild). An entry that
 * still cannot be decrypted — a keystore key that no longer exists — reads as
 * "not signed in" and is dropped, so the listener just signs in again.
 */
import * as SecureStore from 'expo-secure-store';

import type { TokenStorage } from '@convex-dev/auth/react';

const safeKey = (key: string): string => key.replace(/[^A-Za-z0-9._-]/g, '_');

export const secureStorage: TokenStorage = {
  getItem: async key => {
    try {
      return await SecureStore.getItemAsync(safeKey(key));
    } catch {
      await SecureStore.deleteItemAsync(safeKey(key)).catch(() => undefined);
      return null;
    }
  },
  setItem: (key, value) => SecureStore.setItemAsync(safeKey(key), value),
  removeItem: key => SecureStore.deleteItemAsync(safeKey(key)),
};
