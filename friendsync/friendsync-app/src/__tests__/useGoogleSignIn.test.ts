// ============================================================================
// Setup manual mocks for modules that need them
// ============================================================================

// Tell Jest to use the manual mock for sync
jest.mock('../../lib/sync');

// Mock React Native Platform
jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
    select: jest.fn((obj: any) => obj.android || obj.native || obj.default),
  },
}));

// Mock expo modules
jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('expo-auth-session', () => ({
  makeRedirectUri: jest.fn(() => 'exp://localhost:19000'),
}));

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    multiRemove: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(null),
    getItem: jest.fn().mockResolvedValue(null),
  },
}));

// Mock Firebase Auth - define mocks INSIDE the factory function
jest.mock('firebase/auth', () => {
  class MockGoogleAuthProvider {
    static credential(idToken: string) {
      return { providerId: 'google.com', token: idToken };
    }
    setCustomParameters() {
      return this;
    }
  }

  return {
    __esModule: true,
    signOut: jest.fn().mockResolvedValue(undefined),
    signInWithCredential: jest.fn().mockResolvedValue({ user: { uid: 'test-uid' } }),
    signInWithPopup: jest.fn().mockResolvedValue({ user: { uid: 'test-uid' } }),
    GoogleAuthProvider: MockGoogleAuthProvider,
  };
});

// Mock Firestore
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: jest.fn(() => ({ id: 'mock-doc-id' })),
  setDoc: jest.fn().mockResolvedValue(undefined),
}));

// Mock Firebase config
jest.mock('../../lib/firebase', () => ({
  __esModule: true,
  auth: {
    currentUser: {
      uid: 'test-uid',
      email: 'test@example.com',
      displayName: 'Test User',
      photoURL: null,
      getIdToken: jest.fn().mockResolvedValue('mock-token'),
    },
  },
  db: {},
}));

// Mock local database
jest.mock('../../lib/db', () => ({
  __esModule: true,
  default: {
    init_db: jest.fn().mockResolvedValue(undefined),
    getUserByEmail: jest.fn().mockResolvedValue(null),
    createUser: jest.fn().mockResolvedValue(1),
    getUserById: jest.fn().mockResolvedValue({ userId: 1, username: 'testuser' }),
    updateUser: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock event bus
jest.mock('../../lib/eventBus', () => ({
  __esModule: true,
  emit: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
}));

// Import modules after mocks are set up
import { useGoogleSignIn } from '../features/auth/useGoogleSignIn';
import * as simpleSync from '../../lib/sync';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as firebaseAuth from 'firebase/auth';
import { Platform } from 'react-native';

describe('useGoogleSignIn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs in Android environment', () => {
    expect(Platform.OS).toBe('android');
  });

  describe('logout', () => {
    it('stops auto sync', async () => {
      const { logout } = useGoogleSignIn();
      await logout();

      expect(simpleSync.stopAutoSync).toHaveBeenCalledTimes(1);
    });

    it('calls Firebase signOut', async () => {
      const { logout } = useGoogleSignIn();
      await logout();

      expect(firebaseAuth.signOut).toHaveBeenCalledTimes(1);
    });

    it('clears AsyncStorage auth keys', async () => {
      const { logout } = useGoogleSignIn();
      await logout();

      // AsyncStorage is already the default export, so we don't need .default
      const AsyncStorageMock = require('@react-native-async-storage/async-storage').default;
      expect(AsyncStorageMock.multiRemove).toHaveBeenCalledWith([
        'authToken',
        'userId',
        'userEmail',
        'userName',
        'firebaseUid',
      ]);
    });

    it('performs all logout steps in sequence', async () => {
      const { logout } = useGoogleSignIn();
      await logout();

      const AsyncStorageMock = require('@react-native-async-storage/async-storage').default;
      expect(simpleSync.stopAutoSync).toHaveBeenCalled();
      expect(firebaseAuth.signOut).toHaveBeenCalled();
      expect(AsyncStorageMock.multiRemove).toHaveBeenCalled();
    });
  });

  describe('signIn', () => {
    it('returns a function', () => {
      const { signIn } = useGoogleSignIn();
      expect(typeof signIn).toBe('function');
    });
  });
});
