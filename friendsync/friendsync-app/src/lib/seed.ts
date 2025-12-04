import db from './db';
import AsyncStorage from '@react-native-async-storage/async-storage';

type SeedResult = {
  users: { id: number; username: string }[];
  events: { id: number; ownerId: number; title?: string }[];
  friends: { rowId: number; a: number; b: number }[];
  notifications: { id: number; userId: number }[];
  rsvps?: { id: number; eventId: number; inviteRecipientId: number; status?: string }[];
};

/**
 * seedDummyData - populate the DB (native or fallback) with a small set of test data.
 * Call this in development only. The function is automatically attached to globalThis.seedDummyData
 * when running in __DEV__ so you can call it from the debugger console.
 */
export async function seedDummyData(opts?: { force?: boolean; randomize?: boolean; randomCount?: number; randomSeed?: number; days?: number; randomTimes?: boolean }): Promise<SeedResult> {
  if (!__DEV__ && !((globalThis as any).__FORCE_SEED__ === true)) {
    throw new Error('seedDummyData can only be run in development unless __FORCE_SEED__ is set.');
  }

  await db.init_db();

  const createdUsers: { id: number; username: string }[] = [];
  const createdEvents: { id: number; ownerId: number; title?: string }[] = [];
  const createdFriends: { rowId: number; a: number; b: number }[] = [];
  const createdNotifications: { id: number; userId: number }[] = [];
  const createdRsvps: { id: number; eventId: number; inviteRecipientId: number; status?: string }[] = [];

  // ---------- RNG configuration and helper utilities (used when opts.randomize === true) ----------
  // allow optional deterministic seeding via opts.randomSeed
  let rng = () => Math.random();
  if (opts && typeof opts.randomSeed === 'number') {
    // simple LCG (32-bit) for repeatable sequences in dev
    let seedVal = opts.randomSeed >>> 0;
    rng = () => {
      seedVal = (seedVal * 1664525 + 1013904223) >>> 0;
      return seedVal / 0x100000000;
    };
  }

  function randInt(min: number, max: number) {
    // inclusive min, inclusive max
    return Math.floor(rng() * (max - min + 1)) + min;
  }

  function pick<T>(arr: T[]) {
    return arr[Math.floor(rng() * arr.length)];
  }

  function randDateBetween(start: Date, end: Date) {
    const s = start.getTime();
    const e = end.getTime();
    const t = Math.floor(rng() * (e - s + 1)) + s;
    return new Date(t);
  }

  async function createRandomEventForUser(userId: number) {
    // 70% chance to create an actual event, 30% to create a free-time slot
    const isEvent = rng() < 0.7;
    // choose a start within next 30 days
    const now = new Date();
    const start = randDateBetween(now, new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));
    // start hour between 7 and 20 (7am - 8pm)
    start.setHours(randInt(7, 20), randInt(0, 59), 0, 0);
    // duration between 30 and 180 minutes
    const durationMin = randInt(30, 180);
    const end = new Date(start.getTime() + durationMin * 60 * 1000);

    const titles = [
      'Coffee', 'Lunch', 'Study Session', 'Gym', 'Focus Block', 'Project Meeting', 'Call', 'Planning', 'Review', 'Workshop'
    ];
    const title = `${pick(titles)}${rng() < 0.2 ? ' (w/ friends)' : ''}`;

    if (isEvent) {
      const evId = await db.createEvent({
        userId,
        eventTitle: title,
        description: 'Auto-generated event',
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        date: new Date(start.getFullYear(), start.getMonth(), start.getDate()).toISOString(),
      });
      createdEvents.push({ id: evId, ownerId: userId, title });

      // randomly create RSVPs from friends (10-40% of friends)
      const friendIds = createdFriends
        .filter(f => f.a === userId || f.b === userId)
        .map(f => (f.a === userId ? f.b : f.a));
      if (friendIds.length > 0) {
        const toInviteCount = Math.max(0, Math.round(friendIds.length * (rng() * 0.4)));
        for (let i = 0; i < toInviteCount; i++) {
          const recip = pick(friendIds);
          try {
            const status = rng() < 0.6 ? 'accepted' : (rng() < 0.5 ? 'pending' : 'declined');
            const r = await db.createRsvp({ eventId: evId, eventOwnerId: userId, inviteRecipientId: recip, status });
            createdRsvps.push({ id: r, eventId: evId, inviteRecipientId: recip, status });
          } catch (e) {
            // ignore RSVP errors in seeding
          }
        }
      }
    } else {
      // create free time
      const ftId = await db.addFreeTime({ userId, startTime: start.toISOString(), endTime: end.toISOString() });
      createdEvents.push({ id: ftId, ownerId: userId, title: 'Free time (auto)' });
    }
  }

  // Helper to ensure a user with given email exists and is recorded in createdUsers
  async function ensureUser(username: string, email: string) {
    const existing = await db.getUserByEmail(email);
    if (existing && existing.userId) {
      // avoid duplicates in createdUsers
      if (!createdUsers.find(u => u.id === existing.userId)) createdUsers.push({ id: existing.userId, username: existing.username });
      return existing.userId as number;
    }
    const id = await db.createUser({ username, email });
    createdUsers.push({ id, username });
    return id;
  }

  // Detect currently-signed-in user's email (if any) and ensure a local user exists
  const signedInEmail = await AsyncStorage.getItem('userEmail');
  let primaryUserId: number | null = null;
  if (signedInEmail) {
    const existing = await db.getUserByEmail(signedInEmail);
    if (existing && existing.userId) {
      if (!createdUsers.find(u => u.id === existing.userId)) createdUsers.push({ id: existing.userId, username: existing.username });
      primaryUserId = existing.userId;
    } else {
      const uname = signedInEmail.split('@')[0];
      const nid = await db.createUser({ username: uname, email: signedInEmail });
      createdUsers.push({ id: nid, username: uname });
      primaryUserId = nid;
    }
  }

  // Create (or ensure) example users
  // If a signed-in local user was detected, make them the primary seeded user
  // and create two friends for them so the seeded data is centered around
  // the currently signed-in developer. Otherwise fall back to alice/bob/carol.
  let alice: number;
  let bob: number;
  let carol: number;

  if (primaryUserId) {
    // Ensure primary user is present in createdUsers (detection earlier may have added them)
    const prim = await db.getUserById(primaryUserId);
    if (prim && prim.userId) {
      if (!createdUsers.find(u => u.id === prim.userId)) createdUsers.push({ id: prim.userId, username: prim.username || `user${prim.userId}` });
      // ensure primary is first
      const idx = createdUsers.findIndex(u => u.id === prim.userId);
      if (idx > 0) {
        const [u] = createdUsers.splice(idx, 1);
        createdUsers.unshift(u);
      }
      alice = prim.userId;
    } else {
      // fallback: create a user from stored email/name
      const uname = signedInEmail ? signedInEmail.split('@')[0] : `devuser${Date.now()}`;
      const nid = await db.createUser({ username: uname, email: signedInEmail ?? `${uname}@example.com` });
      createdUsers.push({ id: nid, username: uname });
      alice = nid;
      // ensure primary set
      primaryUserId = nid;
    }

    // create two friend users for the primary user
    bob = await ensureUser('friend_bob', `friend_bob+${alice}@example.com`);
    carol = await ensureUser('friend_carol', `friend_carol+${alice}@example.com`);

    // make them friends with primary
    const fr1 = await db.sendFriendRequest(alice, bob);
    await db.respondFriendRequest(fr1, true);
    createdFriends.push({ rowId: fr1, a: alice, b: bob });

    const fr2 = await db.sendFriendRequest(alice, carol);
    await db.respondFriendRequest(fr2, true);
    createdFriends.push({ rowId: fr2, a: alice, b: carol });
  } else {
    // legacy deterministic seed when no signed-in user present
    alice = await ensureUser('alice', 'alice@example.com');
    bob = await ensureUser('bob', 'bob@example.com');
    carol = await ensureUser('carol', 'carol@example.com');

    // If we detected a signed-in user earlier, prefer them as the first created user for deterministic seeding
    if (primaryUserId) {
      const idx = createdUsers.findIndex(u => u.id === primaryUserId);
      if (idx > 0) {
        const [u] = createdUsers.splice(idx, 1);
        createdUsers.unshift(u);
      }
    }

    // Create friendships (Alice <-> Bob accepted, Bob <-> Carol accepted)
    const fr1 = await db.sendFriendRequest(alice, bob);
    await db.respondFriendRequest(fr1, true);
    createdFriends.push({ rowId: fr1, a: alice, b: bob });

    const fr2 = await db.sendFriendRequest(bob, carol);
    await db.respondFriendRequest(fr2, true);
    createdFriends.push({ rowId: fr2, a: bob, b: carol });
  }

  // Create events for users
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

  // Keep event titles neutral (no creator name embedded)
  const e1 = await db.createEvent({ userId: alice, eventTitle: 'Team Meeting', description: 'Discuss project', startTime: inOneHour, endTime: inTwoHours, date: now.toISOString() });
  createdEvents.push({ id: e1, ownerId: alice, title: 'Team Meeting' });

  const e2 = await db.createEvent({ userId: bob, eventTitle: 'Lunch', description: 'Lunch with team', startTime: inOneHour, endTime: inTwoHours, date: now.toISOString() });
  createdEvents.push({ id: e2, ownerId: bob, title: 'Lunch' });

  // Free time slot for Carol
  const ft = await db.addFreeTime({ userId: carol, startTime: inOneHour, endTime: inTwoHours });
  createdEvents.push({ id: ft, ownerId: carol, title: 'Free time' });

  // --- Additional example free-time slots and friend events ---
  // Add several free-time slots across different users and times so the
  // calendar view is populated with varied data during development.
  const in30Min = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
  const in3Hours = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
  const in5Hours = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStart = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 9, 0, 0).toISOString();
  const tomorrowMid = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), 13, 0, 0).toISOString();

  // Alice free slots (morning quick call, evening workout)
  const a1 = await db.addFreeTime({ userId: alice, startTime: in30Min, endTime: inOneHour });
  createdEvents.push({ id: a1, ownerId: alice, title: 'Quick call (free)' });
  const a2 = await db.addFreeTime({ userId: alice, startTime: in3Hours, endTime: in5Hours });
  createdEvents.push({ id: a2, ownerId: alice, title: 'Evening workout (free)' });

  // Bob free slots (lunch window, afternoon focus)
  const b1 = await db.addFreeTime({ userId: bob, startTime: inOneHour, endTime: in3Hours });
  createdEvents.push({ id: b1, ownerId: bob, title: 'Lunch window (free)' });
  // create a friendly event to show as a friend's event in the calendar
  const be1 = await db.createEvent({ userId: bob, eventTitle: 'Team Standup', description: 'Daily sync', startTime: tomorrowStart, endTime: tomorrowMid, date: tomorrow.toISOString() });
  createdEvents.push({ id: be1, ownerId: bob, title: 'Team Standup' });

  // Carol friend events (study group, coffee)
  const ce1 = await db.createEvent({ userId: carol, eventTitle: 'Study Group', description: 'Exam prep', startTime: tomorrowStart, endTime: tomorrowMid, date: tomorrow.toISOString() });
  createdEvents.push({ id: ce1, ownerId: carol, title: 'Study Group' });
  const ce2 = await db.createEvent({ userId: carol, eventTitle: 'Coffee', description: 'Catch up', startTime: inTwoHours, endTime: in3Hours, date: now.toISOString() });
  createdEvents.push({ id: ce2, ownerId: carol, title: 'Coffee' });

  // end additional seed entries

  // --- More examples across several days ---
  // Create a set of predictable example events across the next 7 days so
  // the calendar shows multi-day content for development without relying
  // on random seeds. These are lightweight, deterministic examples.
  try {
    // Support an adjustable number of days (default = remainder of current month, max 30).
    // If `randomTimes` is true, vary per-user start times within sensible windows using the
    // seeded RNG so results can be deterministic when `randomSeed` is provided.
    const today = new Date();
    const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const daysRemainingInMonth = Math.max(1, Math.floor((lastOfMonth.getDate() - today.getDate()) + 1));
    const requestedDays = typeof opts?.days === 'number' ? Math.max(1, Math.min(30, Math.floor(opts!.days))) : Math.min(30, daysRemainingInMonth);
    const DAYS = requestedDays;
    const randomTimes = !!opts?.randomTimes;
    for (let d = 0; d < DAYS; d++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
      const dayIso = new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString();

      // Determine per-user start hours. If randomTimes is enabled, pick a
      // time within a sensible window for each user using the seeded RNG.
      const aliceHour = randomTimes ? randInt(7, 11) : 9;
      const aliceMinute = randomTimes ? pick([0, 15, 30, 45]) : 0;
      const aliceStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), aliceHour, aliceMinute, 0).toISOString();
      const aliceEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), aliceHour, aliceMinute + 30, 0).toISOString();
      const aEv = await db.createEvent({ userId: createdUsers[0].id, eventTitle: `Daily Sync (day ${d+1})`, description: 'Daily quick sync', startTime: aliceStart, endTime: aliceEnd, date: dayIso });
      createdEvents.push({ id: aEv, ownerId: createdUsers[0].id, title: `Daily Sync (day ${d+1})` });

      // Bob: lunch window on weekdays at ~12:00-13:00 (skip weekend-like indices).
      // If randomTimes is enabled, shift the lunch start between 11-13:30.
      const bobIndex = createdUsers.findIndex(u => u.username === 'bob');
      if (bobIndex >= 0) {
        const dow = day.getDay(); // 0=Sun,6=Sat
        if (dow !== 0 && dow !== 6) {
          const bobHour = randomTimes ? randInt(11, 13) : 12;
          const bobMinute = randomTimes ? pick([0, 15, 30]) : 0;
          const bobStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), bobHour, bobMinute, 0).toISOString();
          const bobEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), bobHour + 1, bobMinute, 0).toISOString();
          const bEv = await db.createEvent({ userId: createdUsers[bobIndex].id, eventTitle: `Lunch (day ${d+1})`, description: 'Team lunch', startTime: bobStart, endTime: bobEnd, date: dayIso });
          createdEvents.push({ id: bEv, ownerId: createdUsers[bobIndex].id, title: `Lunch (day ${d+1})` });
        }
      }

      // Carol: study session on even days at ~18:00-20:00. If randomTimes is
      // enabled, pick an evening start between 17-20.
      const carolIndex = createdUsers.findIndex(u => u.username === 'carol');
      if (carolIndex >= 0 && (d % 2) === 0) {
        const carolHour = randomTimes ? randInt(17, 20) : 18;
        const carolMinute = randomTimes ? pick([0, 15, 30]) : 0;
        const cStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), carolHour, carolMinute, 0).toISOString();
        const cEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), carolHour + 2, carolMinute, 0).toISOString();
        const cEv = await db.createEvent({ userId: createdUsers[carolIndex].id, eventTitle: `Study (day ${d+1})`, description: 'Study group', startTime: cStart, endTime: cEnd, date: dayIso });
        createdEvents.push({ id: cEv, ownerId: createdUsers[carolIndex].id, title: `Study (day ${d+1})` });
      }

      // Additionally add a free-time slot for Alice mid-afternoon on odd days
      if ((d % 2) === 1) {
        const aftHour = randomTimes ? randInt(14, 16) : 15;
        const ftS = new Date(day.getFullYear(), day.getMonth(), day.getDate(), aftHour, 0, 0).toISOString();
        const ftE = new Date(day.getFullYear(), day.getMonth(), day.getDate(), aftHour + 1, 0, 0).toISOString();
        const ftId2 = await db.addFreeTime({ userId: createdUsers[0].id, startTime: ftS, endTime: ftE });
        createdEvents.push({ id: ftId2, ownerId: createdUsers[0].id, title: 'Afternoon free' });
      }
    }
  } catch (e) {
    // non-fatal for seed
    // eslint-disable-next-line no-console
    console.warn('seed: multi-day examples failed', e);
  }

  // If requested, generate additional randomized events/free-time slots.
  if (opts && opts.randomize) {
    const toCreate = typeof opts.randomCount === 'number' && opts.randomCount > 0 ? opts.randomCount : 10;
    // create events across the users we already created
    for (let i = 0; i < toCreate; i++) {
      const owner = pick(createdUsers.map(u => u.id));
      // defensive check
      if (owner) await createRandomEventForUser(owner);
    }
  }

  // Add more sample users and interactions for richer dev data
  const dave = await ensureUser('dave', 'dave@example.com');
  const eve = await ensureUser('eve', 'eve@example.com');
  const frank = await ensureUser('frank', 'frank@example.com');

  // create some accepted friendships among the expanded set
  try {
    const fr3 = await db.sendFriendRequest(carol, dave); await db.respondFriendRequest(fr3, true); createdFriends.push({ rowId: fr3, a: carol, b: dave });
    const fr4 = await db.sendFriendRequest(dave, eve); await db.respondFriendRequest(fr4, true); createdFriends.push({ rowId: fr4, a: dave, b: eve });
    const fr5 = await db.sendFriendRequest(eve, frank); await db.respondFriendRequest(fr5, true); createdFriends.push({ rowId: fr5, a: eve, b: frank });
    const fr6 = await db.sendFriendRequest(bob, frank); await db.respondFriendRequest(fr6, true); createdFriends.push({ rowId: fr6, a: bob, b: frank });
    const fr7 = await db.sendFriendRequest(alice, eve); await db.respondFriendRequest(fr7, true); createdFriends.push({ rowId: fr7, a: alice, b: eve });
  } catch (e) { /* non-fatal */ }

  // Create some extra events for these users across the month
  try {
    const day = new Date();
    const dayIso = new Date(day.getFullYear(), day.getMonth(), Math.min(day.getDate() + 3, new Date(day.getFullYear(), day.getMonth()+1, 0).getDate())).toISOString();
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 11, 0, 0).toISOString();
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0).toISOString();
    const d1 = await db.createEvent({ userId: dave, eventTitle: 'Design Review', description: 'Review designs', startTime: start, endTime: end, date: dayIso }); createdEvents.push({ id: d1, ownerId: dave, title: 'Design Review' });
    const e1x = await db.createEvent({ userId: eve, eventTitle: 'Coffee Break', description: 'Informal chat', startTime: start, endTime: end, date: dayIso }); createdEvents.push({ id: e1x, ownerId: eve, title: 'Coffee Break' });
    const f1 = await db.createEvent({ userId: frank, eventTitle: 'Sprint Planning', description: 'Plan next sprint', startTime: start, endTime: end, date: dayIso }); createdEvents.push({ id: f1, ownerId: frank, title: 'Sprint Planning' });
  } catch (e) { /* non-fatal */ }

  // Create RSVPs for a selection of events to show interactions
  try {
    const knownUserIds = createdUsers.map(u => u.id);
    for (const ce of createdEvents.slice()) {
      // skip free-time entries
      if (!ce.title || /free/i.test(String(ce.title))) continue;
      // pick up to 3 random invitees excluding owner
      const ownersId = ce.ownerId;
      const candidates = knownUserIds.filter(id => id !== ownersId);
      const inviteCount = Math.min(3, Math.max(0, Math.floor(rng() * candidates.length)));
      for (let i = 0; i < inviteCount; i++) {
        const recip = pick(candidates);
        try {
          const status = rng() < 0.6 ? 'accepted' : (rng() < 0.5 ? 'pending' : 'declined');
          const r = await db.createRsvp({ eventId: ce.id, eventOwnerId: ownersId, inviteRecipientId: recip, status });
          createdRsvps.push({ id: r, eventId: ce.id, inviteRecipientId: recip, status });
        } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* non-fatal */ }

  // Preferences
  await db.setUserPreferences(alice, { theme: 1, notificationEnabled: 1, colorScheme: 0 });
  await db.setUserPreferences(bob, { theme: 0, notificationEnabled: 1, colorScheme: 1 });

  // RSVPs — Bob and Carol RSVP to Alice's event, Alice RSVPs to Bob's
  try {
    const r1 = await db.createRsvp({ eventId: e1, eventOwnerId: alice, inviteRecipientId: bob, status: 'accepted' });
    createdRsvps.push({ id: r1, eventId: e1, inviteRecipientId: bob, status: 'accepted' });

    const r2 = await db.createRsvp({ eventId: e1, eventOwnerId: alice, inviteRecipientId: carol, status: 'pending' });
    createdRsvps.push({ id: r2, eventId: e1, inviteRecipientId: carol, status: 'pending' });

    const r3 = await db.createRsvp({ eventId: e2, eventOwnerId: bob, inviteRecipientId: alice, status: 'accepted' });
    createdRsvps.push({ id: r3, eventId: e2, inviteRecipientId: alice, status: 'accepted' });
  } catch (e) {
    // if RSVP functions are unavailable or fail for native reasons, continue without blocking seed
    // eslint-disable-next-line no-console
    console.warn('seed: rsvp creation failed', e);
  }

  // Dev helper: print primary local user id that was targeted by the seeder so devs can easily set localStorage for testing
  try {
    const targetId = primaryUserId ?? (createdUsers && createdUsers.length > 0 ? createdUsers[0].id : null);
    // Dev: automatically write numeric local userId to storage so Home loads seeded events immediately
    if (__DEV__) {
      try {
        if (typeof AsyncStorage !== 'undefined' && AsyncStorage.setItem) {
          await AsyncStorage.setItem('userId', String(targetId));
        }
      } catch (e) {
        // ignore AsyncStorage write errors
      }
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('userId', String(targetId));
        }
      } catch (e) {
        // ignore localStorage write errors
      }

      // Also persist a friendly userName and email for dev convenience
      try {
        const u = await db.getUserById(Number(targetId));
        if (u) {
          if (u.username) {
            try { await AsyncStorage.setItem('userName', String(u.username)); } catch {}
            try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem('userName', String(u.username)); } catch {}
          }
          if (u.email) {
            try { await AsyncStorage.setItem('userEmail', String(u.email)); } catch {}
            try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem('userEmail', String(u.email)); } catch {}
          }
        }
      } catch (e) {
        // ignore
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[seedDummyData] primary local userId: ${targetId} — stored to storage for dev (localStorage and AsyncStorage).`);
  } catch (e) {
    // ignore logging errors
  }

  return { users: createdUsers, events: createdEvents, friends: createdFriends, notifications: createdNotifications, rsvps: createdRsvps };
}

// Auto-attach in dev for convenience
if (__DEV__) {
  try { (globalThis as any).seedDummyData = seedDummyData; } catch (e) { /* ignore */ }
}

export default seedDummyData;
