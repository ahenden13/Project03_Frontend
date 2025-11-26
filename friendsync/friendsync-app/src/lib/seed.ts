import db from './db';

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


  // Create users
  const alice = await db.createUser({ username: 'alice', email: 'alice@example.com' });
  createdUsers.push({ id: alice, username: 'alice' });

  const bob = await db.createUser({ username: 'bob', email: 'bob@example.com' });
  createdUsers.push({ id: bob, username: 'bob' });

  const carol = await db.createUser({ username: 'carol', email: 'carol@example.com' });
  createdUsers.push({ id: carol, username: 'carol' });

  // Create friendships (Alice <-> Bob accepted, Bob <-> Carol accepted)
  const fr1 = await db.sendFriendRequest(alice, bob);
  await db.respondFriendRequest(fr1, true);
  createdFriends.push({ rowId: fr1, a: alice, b: bob });

  const fr2 = await db.sendFriendRequest(bob, carol);
  await db.respondFriendRequest(fr2, true);
  createdFriends.push({ rowId: fr2, a: bob, b: carol });

  // Create events for users
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

  const e1 = await db.createEvent({ userId: alice, eventTitle: 'Alice Meeting', description: 'Discuss project', startTime: inOneHour, endTime: inTwoHours, date: now.toISOString() });
  createdEvents.push({ id: e1, ownerId: alice, title: 'Alice Meeting' });

  const e2 = await db.createEvent({ userId: bob, eventTitle: 'Bob Lunch', description: 'Lunch with team', startTime: inOneHour, endTime: inTwoHours, date: now.toISOString() });
  createdEvents.push({ id: e2, ownerId: bob, title: 'Bob Lunch' });

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
  // create a friendly event to show as a friend's event in the calendar
  const be1 = await db.createEvent({ userId: bob, eventTitle: 'Bob: Team Standup', description: 'Daily sync', startTime: tomorrowStart, endTime: tomorrowMid, date: tomorrow.toISOString() });
  createdEvents.push({ id: be1, ownerId: bob, title: 'Team Standup' });

  // Carol friend events (study group, coffee)
  const ce1 = await db.createEvent({ userId: carol, eventTitle: 'Carol: Study Group', description: 'Exam prep', startTime: tomorrowStart, endTime: tomorrowMid, date: tomorrow.toISOString() });
  createdEvents.push({ id: ce1, ownerId: carol, title: 'Study Group' });
  const ce2 = await db.createEvent({ userId: carol, eventTitle: 'Carol: Coffee', description: 'Catch up', startTime: inTwoHours, endTime: in3Hours, date: now.toISOString() });
  createdEvents.push({ id: ce2, ownerId: carol, title: 'Coffee' });

  // end additional seed entries

  // --- More examples across several days ---
  // Create a set of predictable example events across the next 7 days so
  // the calendar shows multi-day content for development without relying
  // on random seeds. These are lightweight, deterministic examples.
  try {
    // Support an adjustable number of days (default 7, max 30). If `randomTimes`
    // is true, vary per-user start times within sensible windows using the
    // seeded RNG so results can be deterministic when `randomSeed` is provided.
    const requestedDays = typeof opts?.days === 'number' ? Math.max(1, Math.min(30, Math.floor(opts!.days))) : 7;
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
      const aEv = await db.createEvent({ userId: createdUsers[0].id, eventTitle: `Alice: Daily Sync (day ${d+1})`, description: 'Daily quick sync', startTime: aliceStart, endTime: aliceEnd, date: dayIso });
      createdEvents.push({ id: aEv, ownerId: createdUsers[0].id, title: `Alice: Daily Sync (day ${d+1})` });

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
          const bEv = await db.createEvent({ userId: createdUsers[bobIndex].id, eventTitle: `Bob: Lunch (day ${d+1})`, description: 'Team lunch', startTime: bobStart, endTime: bobEnd, date: dayIso });
          createdEvents.push({ id: bEv, ownerId: createdUsers[bobIndex].id, title: `Bob: Lunch (day ${d+1})` });
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
        const cEv = await db.createEvent({ userId: createdUsers[carolIndex].id, eventTitle: `Carol: Study (day ${d+1})`, description: 'Study group', startTime: cStart, endTime: cEnd, date: dayIso });
        createdEvents.push({ id: cEv, ownerId: createdUsers[carolIndex].id, title: `Carol: Study (day ${d+1})` });
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

  // Preferences
  await db.setUserPreferences(alice, { theme: 1, notificationEnabled: 1, colorScheme: 0 });
  await db.setUserPreferences(bob, { theme: 0, notificationEnabled: 1, colorScheme: 1 });

  // Notifications
  const n1 = await db.addNotification({ userId: alice, notifMsg: 'Welcome Alice!', notifType: 'welcome' });
  createdNotifications.push({ id: n1, userId: alice });

  const n2 = await db.addNotification({ userId: bob, notifMsg: 'You have a new friend', notifType: 'friend' });
  createdNotifications.push({ id: n2, userId: bob });

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

  return { users: createdUsers, events: createdEvents, friends: createdFriends, notifications: createdNotifications, rsvps: createdRsvps };
}

// Auto-attach in dev for convenience
if (__DEV__) {
  try { (globalThis as any).seedDummyData = seedDummyData; } catch (e) { /* ignore */ }
}

export default seedDummyData;
