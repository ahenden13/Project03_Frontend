// Small platform-agnostic re-export for Firebase helpers
import { Platform } from 'react-native';

let resolved: any = null;
function resolvePlatformModule(): any {
  if (resolved) return resolved;
  try {
    if (Platform.OS === 'web') resolved = require('./firebase.web');
    else resolved = require('./firebase.native');
  } catch (e) {
    // best-effort: leave resolved as empty object
    resolved = {};
    // don't rethrow — callers will guard for missing auth/db
  }
  return resolved;
}

const firebaseProxy = {
  get auth() { return resolvePlatformModule().auth; },
  get db() { return resolvePlatformModule().db; }
};

export default firebaseProxy;
