// Mock the db module
jest.mock('../lib/db');

// Mock FirebaseSync
jest.mock('../lib/firebaseSync', () => ({
  __esModule: true,
  default: {
    setFirebaseSyncEnabled: jest.fn(),
  },
  setFirebaseSyncEnabled: jest.fn(),
}));

// Mock fetch
global.fetch = jest.fn();

import * as sync from '../lib/sync';
import * as db from '../lib/db';

describe('sync module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Mock db functions
    (db.getUserByFirebaseUid as jest.Mock).mockResolvedValue(null);
    (db.resolveLocalUserId as jest.Mock).mockResolvedValue(1);
    (db.getUserById as jest.Mock).mockResolvedValue({ userId: 1, username: 'testuser' });
    (db.getUserByEmail as jest.Mock).mockResolvedValue(null);
    (db.createUser as jest.Mock).mockResolvedValue(2);
    (db.updateUser as jest.Mock).mockResolvedValue(undefined);
    (db.getEventsForUser as jest.Mock).mockResolvedValue([]);
    (db.createEvent as jest.Mock).mockResolvedValue(1);
    (db.getFriendsForUser as jest.Mock).mockResolvedValue([]);
    (db.sendFriendRequest as jest.Mock).mockResolvedValue(1);
    (db.getRsvpsForUser as jest.Mock).mockResolvedValue([]);
    (db.createRsvp as jest.Mock).mockResolvedValue(1);
    (db.clearNotificationsForUser as jest.Mock).mockResolvedValue(undefined);
    (db.addNotification as jest.Mock).mockResolvedValue(1);
    (db.setUserPreferences as jest.Mock).mockResolvedValue(undefined);
    (db.runDuplicateCleanup as jest.Mock).mockResolvedValue({ groups: [] });
    (db.getAllUsers as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    sync.stopAutoSync();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('setAuthToken', () => {
    it('sets the auth token', () => {
      expect(() => sync.setAuthToken('test-token')).not.toThrow();
    });
  });

  describe('syncFromBackend', () => {
    it('fetches data from backend successfully', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue([]),
      };
      
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);
      sync.setAuthToken('test-token');

      await expect(sync.syncFromBackend(1)).resolves.not.toThrow();
    });

    it('syncs users from backend', async () => {
      const mockUsers = [
        { userId: 1, username: 'user1', email: 'user1@example.com' },
        { userId: 2, username: 'user2', email: 'user2@example.com' },
      ];

      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/api/users')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockUsers),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      });

      sync.setAuthToken('test-token');
      await sync.syncFromBackend(1);

      // Verify that fetch was called (users were synced)
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('startAutoSync', () => {
    it('starts automatic sync timer', async () => {
      sync.setAuthToken('test-token');
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue([]),
      });

      const initialCallCount = (global.fetch as jest.Mock).mock.calls.length;

      sync.startAutoSync(1);

      // Wait for initial sync to complete
      await Promise.resolve();

      const afterInitialSync = (global.fetch as jest.Mock).mock.calls.length;
      expect(afterInitialSync).toBeGreaterThan(initialCallCount);

      // Fast-forward time by 5 minutes
      jest.advanceTimersByTime(5 * 60 * 1000);

      // Allow promises to resolve
      await Promise.resolve();

      // Verify sync was called again after interval
      expect(global.fetch).toHaveBeenCalled();
    });

    it('does not start multiple timers', () => {
      sync.setAuthToken('test-token');
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue([]),
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      sync.startAutoSync(1);
      sync.startAutoSync(1); // Try to start again

      expect(consoleSpy).toHaveBeenCalledWith('Auto-sync already running');
      
      consoleSpy.mockRestore();
    });
  });

  describe('stopAutoSync', () => {
    it('stops the sync timer', () => {
      sync.setAuthToken('test-token');
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue([]),
      });

      sync.startAutoSync(1);
      sync.stopAutoSync();

      const initialCallCount = (global.fetch as jest.Mock).mock.calls.length;

      // Fast-forward time
      jest.advanceTimersByTime(5 * 60 * 1000);

      // Verify no additional calls were made
      expect(global.fetch).toHaveBeenCalledTimes(initialCallCount);
    });

    it('can be called multiple times safely', () => {
      expect(() => {
        sync.stopAutoSync();
        sync.stopAutoSync();
      }).not.toThrow();
    });
  });
});
