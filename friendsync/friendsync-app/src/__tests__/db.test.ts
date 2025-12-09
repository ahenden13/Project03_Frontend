// Mock storage module with stateful behavior
let mockStorageData = {
  __meta__: { nextId: { users: 1, friends: 1, events: 1, rsvps: 1, user_prefs: 1, notifications: 1 } },
  users: [],
  friends: [],
  events: [],
  rsvps: [],
  user_prefs: [],
  notifications: [],
};

jest.mock('../lib/storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(JSON.parse(JSON.stringify(mockStorageData)))),
    setItem: jest.fn((key, value) => {
      mockStorageData = value;
      return Promise.resolve(undefined);
    }),
    removeItem: jest.fn(),
  },
}));

// Mock React Native Platform
jest.mock('react-native', () => ({
  Platform: {
    OS: 'web',
  },
}));

// Mock Firebase sync
jest.mock('../lib/firebaseSync', () => ({
  __esModule: true,
  isFirebaseSyncEnabled: jest.fn(() => false),
  setFirebaseSyncEnabled: jest.fn(),
  syncUserToFirebase: jest.fn(),
  updateUserInFirebase: jest.fn(),
  deleteUserFromFirebase: jest.fn(),
}));

import db from '../lib/db';
import storage from '../lib/storage';

describe('db - User Operations', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Reset mock storage data
    mockStorageData = {
      __meta__: { nextId: { users: 1, friends: 1, events: 1, rsvps: 1, user_prefs: 1, notifications: 1 } },
      users: [],
      friends: [],
      events: [],
      rsvps: [],
      user_prefs: [],
      notifications: [],
    };
    
    // Initialize the database
    await db.init_db();
  });

  describe('createUser', () => {
    it('creates a new user successfully', async () => {
      const userId = await db.createUser({
        username: 'testuser',
        email: 'test@example.com',
      });

      expect(userId).toBeGreaterThan(0);
      expect(storage.setItem).toHaveBeenCalled();
    });

    it('creates user with firebaseUid', async () => {
      const userId = await db.createUser({
        username: 'testuser',
        email: 'test@example.com',
        firebaseUid: 'firebase-uid-123',
      });

      expect(userId).toBeGreaterThan(0);
      expect(storage.setItem).toHaveBeenCalled();
    });
  });

  describe('getUserById', () => {
    it('returns null for non-existent user', async () => {
      const user = await db.getUserById(999);
      expect(user).toBeNull();
    });

    it('returns user when found', async () => {
      // Create a user first
      const userId = await db.createUser({
        username: 'testuser',
        email: 'test@example.com',
      });

      // Now retrieve it
      const user = await db.getUserById(userId);
      expect(user).toBeTruthy();
      expect(user!.username).toBe('testuser');
      expect(user!.email).toBe('test@example.com');
    });
  });

  describe('getUserByEmail', () => {
    it('returns null for non-existent email', async () => {
      const user = await db.getUserByEmail('nonexistent@example.com');
      expect(user).toBeNull();
    });

    it('finds user by email', async () => {
      await db.createUser({
        username: 'testuser',
        email: 'test@example.com',
      });

      const user = await db.getUserByEmail('test@example.com');
      expect(user).toBeTruthy();
      expect(user!.username).toBe('testuser');
    });
  });

  describe('getUserByFirebaseUid', () => {
    it('returns null for non-existent firebaseUid', async () => {
      const user = await db.getUserByFirebaseUid('nonexistent-uid');
      expect(user).toBeNull();
    });

    it('finds user by firebaseUid', async () => {
      const userId = await db.createUser({
        username: 'testuser',
        email: 'test@example.com',
        firebaseUid: 'firebase-uid-123',
      });

      // Verify user was created
      expect(userId).toBeGreaterThan(0);

      const user = await db.getUserByFirebaseUid('firebase-uid-123');
      expect(user).toBeTruthy();
      expect(user!.username).toBe('testuser');
      expect(user!.firebaseUid).toBe('firebase-uid-123');
    });
  });

  describe('updateUser', () => {
    it('updates user username', async () => {
      const userId = await db.createUser({
        username: 'oldname',
        email: 'test@example.com',
      });

      await db.updateUser(userId, { username: 'newname' });

      const user = await db.getUserById(userId);
      expect(user).toBeTruthy();
      expect(user!.username).toBe('newname');
      expect(user!.email).toBe('test@example.com'); // unchanged
    });

    it('updates multiple fields', async () => {
      const userId = await db.createUser({
        username: 'testuser',
        email: 'old@example.com',
      });

      await db.updateUser(userId, {
        username: 'newuser',
        email: 'new@example.com',
      });

      const user = await db.getUserById(userId);
      expect(user).toBeTruthy();
      expect(user!.username).toBe('newuser');
      expect(user!.email).toBe('new@example.com');
    });
  });

  describe('deleteUser', () => {
    it('deletes user successfully', async () => {
      const userId = await db.createUser({
        username: 'testuser',
        email: 'test@example.com',
      });

      await db.deleteUser(userId);

      const user = await db.getUserById(userId);
      expect(user).toBeNull();
    });
  });

  describe('getAllUsers', () => {
    it('returns empty array when no users', async () => {
      const users = await db.getAllUsers();
      expect(users).toEqual([]);
    });

    it('returns all users', async () => {
      await db.createUser({ username: 'user1', email: 'user1@example.com' });
      await db.createUser({ username: 'user2', email: 'user2@example.com' });
      await db.createUser({ username: 'user3', email: 'user3@example.com' });

      const users = await db.getAllUsers();
      expect(users.length).toBeGreaterThanOrEqual(3);
      
      const usernames = users.map(u => u.username);
      expect(usernames).toContain('user1');
      expect(usernames).toContain('user2');
      expect(usernames).toContain('user3');
    });
  });
});