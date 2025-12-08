// Small platform-agnostic re-export for Firebase helpers
import { Platform } from 'react-native';

let mod: any;
if (Platform.OS === 'web') {
  mod = require('./firebase.web');
} else {
  mod = require('./firebase.native');
}

export const auth = (mod && mod.auth) ? mod.auth : undefined;
export const db = (mod && mod.db) ? mod.db : undefined;

export default { auth, db };
