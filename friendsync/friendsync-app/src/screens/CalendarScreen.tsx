// src/screens/CalendarScreen.tsx

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { View, Text, TouchableOpacity, Dimensions, ScrollView, Modal, TextInput, Button, Pressable } from "react-native";
import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Calendar } from "react-native-calendars"; // Calendar library
import { useTheme } from "../lib/ThemeProvider";
import db from "../lib/db";

/**
 * CalendarScreen
 *
 * Renders a month calendar that is driven by local DB contents (events,
 * availability, RSVPs). This component contains non-trivial layout math to
 * compute a grid height that fits inside the visible viewport. The code below
 * tries to be conservative and accounts for all visible chrome (header,
 * toggles, the calendar's own month/weekday header, top nav, and ScrollView
 * padding). The diagnostics printed to the console help tune the constants
 * when testing on different platforms.
 */
export default function CalendarScreen() {
  const t = useTheme();

  // --- Toggle states for different calendar layers ---
  const [showMine, setShowMine] = useState(true); // My availability
  const [showFriends, setShowFriends] = useState(true); // Friends' availability
  const [showMyEvents, setShowMyEvents] = useState(true); // My events
  // invited events toggle removed per request

  // ---------------------------
  // UI & data state (top-level)
  // ---------------------------

  // Data loaded from DB
  // Start as null so the UI does not prematurely assume seeded user 1
  // (we will set this once AsyncStorage/auth resolves the numeric local id)
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [myAvailability, setMyAvailability] = useState<any[]>([]);
  const [friendAvailability, setFriendAvailability] = useState<any[]>([]);
  const [myEvents, setMyEvents] = useState<any[]>([]);
  // invitedEvents removed
  const [loadingData, setLoadingData] = useState<boolean>(false);

  // initial data arrays are empty and will be populated from db


  //Modal control
  const [modalVisible, setModalVisible] = useState(false);
  
  // --- Organize events by date for fast lookup ---
  // dataByDate: map date-string -> array of normalized items to render on that day
  // Each item is normalized to { date: 'YYYY-MM-DD', time: 'HH:MM', title, type }
  const dataByDate = useMemo(() => {
    const map: Record<string, any[]> = {};

    // Add my events (if enabled)
    if (showMyEvents) {
      myEvents.forEach((item) => {
        if (!map[item.date]) map[item.date] = [];
        map[item.date].push(item);
      });
    }

    // Add my availability/free time (if enabled)
    if (showMine) {
      myAvailability.forEach((item) => {
        if (!map[item.date]) map[item.date] = [];
        map[item.date].push(item);
      });
    }

    // Add friends' events/free time (if enabled)
    if (showFriends) {
      friendAvailability.forEach((item) => {
        if (!map[item.date]) map[item.date] = [];
        map[item.date].push(item);
      });
    }

    return map;
  }, [
    showMine,
    showFriends,
    showMyEvents,
    myAvailability,
    friendAvailability,
    myEvents,
    currentUserId,
  ]);

  // --- Fixed day cell size ---
  // Measure the calendar container width and compute per-day cell width to avoid overlap
  // -----------------------------------------------------------------------------
  // Sizing / layout constants
  // - We compute a per-day width from the calendar container width, then derive
  //   a per-row height to attempt a tight fit. To avoid one-off mismatches we
  //   explicitly account for every piece of vertical chrome when computing how
  //   much vertical space is available for the day grid.
  // -----------------------------------------------------------------------------
  // Track window size so the layout updates when the browser/window is resized
  const [windowSize, setWindowSize] = useState(() => {
    const d = Dimensions.get("window");
    return { width: d.width, height: d.height };
  });

  useEffect(() => {
    const handler = (dims: any) => {
      const w = dims?.window?.width ?? Dimensions.get('window').width;
      const h = dims?.window?.height ?? Dimensions.get('window').height;
      setWindowSize({ width: w, height: h });
    };

    // Add listener (supports different RN versions)
    const sub: any = (Dimensions as any).addEventListener ? Dimensions.addEventListener('change', handler) : null;
    return () => {
      try {
        if (sub && typeof sub.remove === 'function') sub.remove();
        else if ((Dimensions as any).removeEventListener) (Dimensions as any).removeEventListener('change', handler);
      } catch (_) {
        // ignore
      }
    };
  }, []);
  // When the window size changes, update the measured availableHeight so
  // layout math will re-run. The ScrollView onLayout will still replace
  // this with the precise measured height when available.
  useEffect(() => {
    setAvailableHeight((prev) => Math.min(prev ?? windowSize.height, windowSize.height));
  }, [windowSize]);
  const [calendarWidth, setCalendarWidth] = useState<number | null>(null);
  const [availableHeight, setAvailableHeight] = useState<number | null>(null);
  const [headerHeight, setHeaderHeight] = useState<number>(0);
  const [togglesHeight, setTogglesHeight] = useState<number>(0);
  // Modal state: null = closed, otherwise 'event' | 'list' | 'create'
  const [modalType, setModalType] = useState<null | 'event' | 'list' | 'create'>(null);
  const [modalPayload, setModalPayload] = useState<any>(null);
  // subtract small gaps/padding when computing cell width
  // ScrollView padding values (top and bottom) that affect available space
  const scrollPaddingTop = t.space?.lg ?? 0;
  const scrollPaddingBottom = t.space?.lg ?? 0;
  const rawWidth = calendarWidth ?? windowSize.width;

  // Minimum day cell dimensions (prevents extremely tiny cells on narrow windows)
  const MIN_DAY_CELL_WIDTH = 48; // px
  // Increase minimum day cell height so pills and labels remain readable
  // on narrower viewports and to improve tap targets on touch devices.
  const MIN_DAY_CELL_HEIGHT = 56; // px (previously 32)

  // Pill sizing constants used by the day renderer to estimate how many
  // event 'pills' will fit vertically inside a day cell. These are also
  // used to compute a required minimum cell height to ensure at least
  // two pill slots (including a +N more slot) are available.
  // Size of the today badge (rendered for the current day). We account
  // for this explicitly when computing vertical space so it doesn't overlap
  // the event pills.
  const TODAY_BADGE_SIZE = 22;
  // Reserve exactly the badge size for spacing between the day label
  // and the first pill row so non-today cells reserve the same vertical
  // space as the today badge.
  const DAY_NUMBER_SPACE = TODAY_BADGE_SIZE;
  // Visual height of a pill row (includes padding inside the pill)
  // Reduced slightly to account for the added 1px border on top/bottom.
  const PILL_VISUAL_HEIGHT = 14;
  // Vertical spacing between pills (used in layout math and applied as
  // marginBottom on each pill element). Set to 0 so pills render flush.
  const PILL_MARGIN = 0;
  // Extra buffer (px) to conservatively account for border thickness,
  // line-height and any platform rendering differences so our math does
  // not underestimate the rendered pill height and cause overflow.
  const PILL_RENDER_BUFFER = 4;
  const CELL_INNER_PADDING = 4; // inner padding used in render calculation
  const PILL_MIN_SLOTS = 2; // ensure at least this many pill slots

  // Compute per-day width but respect a minimum size so content remains legible
  const dayCellWidth = Math.max(MIN_DAY_CELL_WIDTH, Math.floor((rawWidth - 8) / 7));

  // Vertical sizing: compute rows dynamically (4-6) based on visible month
  const [rows, setRows] = useState<number>(6);
  // removed enforced minimum cell height per user request
  // If we are forcing a fit, compute the exact per-row height so the rows fit the available area
  let computedDayHeight = Math.max(MIN_DAY_CELL_HEIGHT, Math.floor(dayCellWidth * 0.8));
  const extraReserve = 16; // small margin
  // Estimate of the calendar component's internal overhead (month title + weekday names)
  // These are estimates to account for the calendar chrome that sits above the day grid.
  const monthHeaderHeight = 56; // month title + nav arrows (approx)
  const weekDayHeaderHeight = 28; // weekday names row (Mon, Tue, ...)
  const calendarInnerPadding = 16; // extra padding inside calendar
  // Top navigation bar height (app-level). If your app uses a top nav outside
  // this screen, include its height here. If you can measure it at runtime,
  // replace this constant with the measured value.
  const topNavHeight = 56; // conservative estimate; adjust as needed
  // Known style margins that sit between header/toggles and the calendar
  const headerMarginBottom = t.space?.md ?? 0;
  const togglesMarginBottom = t.space?.md ?? 0;
  const scrollAffordanceMargin = 6; // marginBottom used by the small affordance bar
  // Clamp availableHeight to the actual window height when measurements look too large,
  // and subtract a small viewportReserve to account for app chrome / safe-area / unexpected padding.
  const viewportReserve = 56; // px to reduce the effective viewport by (tunable)
  const measuredViewportHeight = (() => {
    const viewportH = windowSize.height;
    const raw = availableHeight != null ? Math.min(availableHeight, viewportH) : viewportH;
    return Math.max(0, raw - viewportReserve);
  })();

  // The ScrollView height includes the header and toggles (they are inside it),
  // so subtract their measured heights here to get the vertical space left for the
  // calendar component itself. Also reserve space for the calendar's internal
  // chrome (month title and weekday header) so the day grid calculation is accurate.
  const availableForGrid = measuredViewportHeight != null
    ? Math.max(0, measuredViewportHeight - extraReserve - headerHeight - headerMarginBottom - togglesHeight - togglesMarginBottom - monthHeaderHeight - weekDayHeaderHeight - scrollPaddingTop - scrollPaddingBottom - topNavHeight - scrollAffordanceMargin)
    : null;
  if (availableForGrid != null) {
    const fitHeight = Math.floor(availableForGrid / rows);
    // remove the lower minimum clamp; allow cells to shrink to fit rows
    // still cap to a reasonable max based on width and keep at least 1px to avoid zero-height
    computedDayHeight = Math.max(MIN_DAY_CELL_HEIGHT, Math.min(fitHeight || Math.floor(dayCellWidth * 1.0), Math.floor(dayCellWidth * 1.0)));
    // Ensure the computed cell height can accommodate at least PILL_MIN_SLOTS pills
    const perItem = PILL_VISUAL_HEIGHT + PILL_MARGIN + PILL_RENDER_BUFFER;
    const requiredMinForPills = DAY_NUMBER_SPACE + CELL_INNER_PADDING + (perItem * PILL_MIN_SLOTS);
    if (computedDayHeight < requiredMinForPills) computedDayHeight = requiredMinForPills;
  }
  let dayCellHeight = computedDayHeight;
  const [calendarContainerHeight, setCalendarContainerHeight] = useState<number | null>(null);
  // grid-only height (day rows + inner padding). The month title and weekday header
  // are treated as calendar "chrome" and handled separately so comparisons remain
  // consistent with availableForGrid (which already subtracts the chrome sizes).
  let calendarGridHeight = dayCellHeight * rows + calendarInnerPadding;
  // total rendered calendar height (grid + chrome)
  let totalCalendarHeight = calendarGridHeight + monthHeaderHeight + weekDayHeaderHeight;

  // If the calendar content is still taller than the available grid space,
  // shrink the per-row height proportionally so the full grid fits without clipping.
  // This is a conservative fallback to avoid the last row being inaccessible.
  // Helper: compute the number of week rows for a given month
  function computeWeeksForMonth(year: number, monthIndex: number) {
    try {
      const firstWeekday = new Date(year, monthIndex, 1).getDay(); // 0=Sun..6=Sat
      const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
      return Math.max(4, Math.min(6, Math.ceil((firstWeekday + daysInMonth) / 7)));
    } catch (e) {
      return 6;
    }
  }

  // Render a single custom day cell for the calendar. This function computes
  // how many event 'pills' fit vertically and shows a '+N more' indicator when
  // items overflow the cell. It always shows at least one visible item when
  // entries are present.
  const renderDay = ({ date, state }: any) => {
    const entries = dataByDate[date.dateString] || [];
    // Visual metrics used to estimate fit (conservative)
    // (constants defined at top so sizing decisions are consistent)
    const availableForPills = Math.max(0, dayCellHeight - DAY_NUMBER_SPACE - CELL_INNER_PADDING);
    const perItem = PILL_VISUAL_HEIGHT + PILL_MARGIN + PILL_RENDER_BUFFER;
    let maxPills = Math.floor(availableForPills / perItem);
    if (!Number.isFinite(maxPills) || maxPills < 0) maxPills = 0;

    const pad2 = (v: number) => (v < 10 ? `0${v}` : String(v));
    const formatLocalYMD = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
    const todayKey = formatLocalYMD(new Date());
    const isToday = date && date.dateString === todayKey;

    // If nothing fits vertically, show a compact count indicator
    if (maxPills === 0) {
      return (
        <View
          style={{
            width: dayCellWidth,
            height: dayCellHeight,
            borderWidth: 0.5,
            borderColor: "#ccc",
            padding: 2,
            borderRadius: 4,
            backgroundColor: state === "disabled" ? "#1c1c1c10" : "transparent",
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {isToday ? (
              <View style={{ width: TODAY_BADGE_SIZE, height: TODAY_BADGE_SIZE, borderRadius: TODAY_BADGE_SIZE/2, backgroundColor: t.color.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 11 }}>{date.day}</Text>
              </View>
            ) : (
              <Text
                style={{
                  color: state === "disabled" ? t.color.textMuted : t.color.text,
                  fontWeight: "600",
                  fontSize: 11,
                  marginBottom: 1,
                }}
              >
                {date.day}
              </Text>
            )}
            {entries.length > 0 && (
              <Text style={{ color: t.color.textMuted, fontSize: 11 }}>
                {entries.length} item{entries.length !== 1 ? 's' : ''}
              </Text>
            )}
          </View>
        </View>
      );
    }

    // Show as many full pills as fit. If there are more entries than that,
    // use the last visible slot to render a '+N more' pill so nothing overflows.
    const willOverflow = entries.length > maxPills;
    let visible: any[] = [];
    let showMoreAsPill = false;
    let moreCount = 0;

    const openCreateModal = (dateStr: string) => {
      setModalType('create');
      setModalPayload({ date: dateStr });
    };

    const renderPill = (it: any, idx: number) => {
      const colorForEntry = (owner?: string, kind?: string) => {
        if (!owner && !kind) return { bg: t.color.accent, border: '#1f74e6' };
        if (owner === 'friend' && kind === 'event') return { bg: '#AF52DE', border: '#8b32c6' };
        if (owner === 'friend' && kind === 'free') return { bg: '#34C759', border: '#2f9e4a' };
        if (owner === 'mine' && kind === 'event') return { bg: '#FF3B30', border: '#d12a24' };
        if (owner === 'mine' && kind === 'free') return { bg: t.color.accent, border: '#1f74e6' };
        return { bg: t.color.accent, border: '#1f74e6' };
      };
      const { bg, border } = colorForEntry(it.owner, it.kind);
      return (
        <TouchableOpacity key={String(idx)} activeOpacity={0.85} onPress={() => { setModalPayload(it); setModalType('event'); }} style={{ marginBottom: PILL_MARGIN }}>
          <View style={{ backgroundColor: bg, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 12, width: '100%', borderWidth: 1, borderColor: border }}>
            <Text numberOfLines={1} ellipsizeMode='tail' style={{ color: '#fff', fontSize: 10 }}>{it.title ?? it.eventTitle ?? ''}</Text>
          </View>
        </TouchableOpacity>
      );
    };
    const renderMorePill = (count: number, dateStr: string) => {
      return (
        <TouchableOpacity key={'more-'+dateStr} onPress={() => { setModalType('list'); setModalPayload({ date: dateStr, entries: entries }); }} style={{ marginBottom: PILL_MARGIN }}>
          <View style={{ backgroundColor: '#444', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 12, width: '100%', borderWidth: 1, borderColor: '#333' }}>
            <Text numberOfLines={1} ellipsizeMode='tail' style={{ color: '#fff', fontSize: 10 }}>+{count} more</Text>
          </View>
        </TouchableOpacity>
      );
    };

    if (!willOverflow) {
      visible = entries.slice(0, maxPills);
    } else {
      if (maxPills === 1) {
        // Only space for a single visible slot: show a '+N more' indicator
        visible = [];
        showMoreAsPill = true;
        moreCount = entries.length;
      } else {
        // Reserve the last slot for the '+N more' pill
        visible = entries.slice(0, Math.max(0, maxPills - 1));
        showMoreAsPill = true;
        moreCount = Math.max(0, entries.length - visible.length);
      }
    }

    return (
      <View
        style={{
          width: dayCellWidth,
          height: dayCellHeight,
          borderWidth: 0.5,
          borderColor: "#ccc",
          padding: 2,
          borderRadius: 4,
          backgroundColor: state === "disabled" ? "#1c1c1c10" : "transparent",
        }}
      >
        {isToday ? (
          <Pressable onPress={() => { if ((dataByDate[date.dateString] || []).length === 0) openCreateModal(date.dateString); }} style={{ width: TODAY_BADGE_SIZE, height: TODAY_BADGE_SIZE, borderRadius: TODAY_BADGE_SIZE/2, backgroundColor: t.color.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 11 }}>{date.day}</Text>
          </Pressable>
        ) : (
          <Pressable onPress={() => { if ((dataByDate[date.dateString] || []).length === 0) openCreateModal(date.dateString); }} style={{ width: TODAY_BADGE_SIZE, height: TODAY_BADGE_SIZE, alignItems: 'center', justifyContent: 'center' }}>
            <Text
              style={{
                color: state === "disabled" ? t.color.textMuted : t.color.text,
                fontWeight: "600",
                fontSize: 11,
                marginBottom: 1,
              }}
            >
              {date.day}
            </Text>
          </Pressable>
        )}

        {visible.map(renderPill)}
        {showMoreAsPill && renderMorePill(moreCount, date.dateString)}
      </View>
    );
  };

  // Load data from DB when currentUserId or toggles change or when the
  // screen regains focus. We extract the loader so it can be invoked from
  // multiple lifecycle hooks (initial mount, dependency changes, and focus).
  const mountedRef = useRef(true);

  const loadData = useCallback(async () => {
  // Debug: indicate loader was called (useful to verify focus events)
  // Commented out to reduce console noise during normal development
  // eslint-disable-next-line no-console
  // console.log('Calendar: loadData called', { currentUserId });
    setLoadingData(true);
    // If the current user id is not yet resolved (e.g. during app startup
    // while AsyncStorage or auth finishes), avoid running DB queries that
    // expect a numeric userId. This prevents the UI from showing seeded
    // user #1 (or throwing) before resolution.
    if (currentUserId == null) {
      // Clear any prior data so the calendar renders empty while waiting
      setMyEvents([]);
      setMyAvailability([]);
      setFriendAvailability([]);
      // invitedEvents removed
      if (mountedRef.current) setLoadingData(false);
      return;
    }
    try {
      await db.init_db();

      // my events and free time
      const myEv = await db.getEventsForUser(currentUserId);
      const myFt = await db.getFreeTimeForUser(currentUserId);

      // friends' free time
      const friendIds = await db.getFriendsForUser(currentUserId);
      const friendEntries: any[] = [];
      await Promise.all(friendIds.map(async (fid) => {
        const fFree = await db.getFreeTimeForUser(fid);
        const u = await db.getUserById(fid);
        const name = u?.username ?? `user:${fid}`;
        (fFree || []).forEach((slot: any) => friendEntries.push({ ...slot, name }));
      }));

      // invited events via RSVPs removed per request

      if (!mountedRef.current) return;

      // Normalize events and free-time into shape the calendar renderer expects:
      const normalizeDate = (iso?: string | null) => {
        try {
          if (!iso) return null;
          const d = new Date(iso);
          if (Number.isNaN(d.getTime())) return null;
          return d.toISOString().slice(0, 10);
        } catch { return null; }
      };

      const fmtTime = (iso?: string | null) => {
        try {
          if (!iso) return '';
          const d = new Date(iso);
          if (Number.isNaN(d.getTime())) return '';
          return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch { return ''; }
      };

      const normalizedMyEvents = (myEv || []).map((e: any) => ({
        ...e,
        date: e.date ? (typeof e.date === 'string' ? (e.date.length >= 10 ? e.date.slice(0, 10) : e.date) : normalizeDate(e.date)) : normalizeDate(e.startTime),
        time: e.startTime ? fmtTime(e.startTime) : '',
        title: e.eventTitle ?? e.title ?? e.description ?? 'Event',
        owner: 'mine',
        kind: (e.isEvent === 0 || e.isEvent === false) ? 'free' : 'event',
      })).filter((x: any) => !!x.date);

      const normalizedMyFree = (myFt || []).map((f: any) => ({
        ...f,
        date: normalizeDate(f.startTime),
        time: fmtTime(f.startTime),
        title: f.eventTitle ?? f.title ?? 'Free',
        owner: 'mine',
        kind: 'free',
      })).filter((x: any) => !!x.date);

      const normalizedFriends = friendEntries.map((f: any) => ({
        ...f,
        date: f.date ? (typeof f.date === 'string' && f.date.length >= 10 ? f.date.slice(0, 10) : normalizeDate(f.date)) : normalizeDate(f.startTime),
        time: f.startTime ? fmtTime(f.startTime) : f.time ?? '',
        title: f.eventTitle ?? f.title ?? f.name ?? 'Event',
        owner: 'friend',
        kind: (f.isEvent === 0 || f.isEvent === false) ? 'free' : 'event',
      })).filter((x: any) => !!x.date);

      // Update state if still mounted
      setMyEvents(normalizedMyEvents);
      setMyAvailability(normalizedMyFree);
      setFriendAvailability(normalizedFriends);
  // Debug: summary of loaded counts (commented out by request)
  // eslint-disable-next-line no-console
  // console.log('Calendar: loadData result', { myEvents: normalizedMyEvents.length, myFree: normalizedMyFree.length, friends: normalizedFriends.length });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Calendar load failed', e);
    } finally {
      if (mountedRef.current) setLoadingData(false);
    }
  }, [currentUserId, showMine, showFriends, showMyEvents]);

  // Call loadData on mount and when dependencies change
  useEffect(() => {
    mountedRef.current = true;
    loadData();
    return () => { mountedRef.current = false; };
  }, [loadData]);

  // Resolve the numeric local `userId` for the calendar on mount.
  // This mirrors the logic in HomeScreen so the calendar shows the same user's data.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await db.init_db();
        const userIdStr = await AsyncStorage.getItem('userId');
        const uid = userIdStr ? Number(userIdStr) : NaN;
        let resolvedUserId = Number.isFinite(uid) && !Number.isNaN(uid) ? uid : null;

        if (resolvedUserId == null) {
          const userEmail = await AsyncStorage.getItem('userEmail');
          if (userEmail) {
            const u = await db.getUserByEmail(userEmail);
            if (u && u.userId) resolvedUserId = Number(u.userId);
          }
        }

        // Dev fallback: pick the first user if still unresolved
        if (resolvedUserId == null && __DEV__) {
          const all = await db.getAllUsers();
          if (all && all.length > 0) resolvedUserId = all[0].userId;
        }

        if (mounted) setCurrentUserId(resolvedUserId);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('Calendar: failed to resolve userId', err);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // --- Modals ---
  const closeModal = () => { setModalType(null); setModalPayload(null); };

  const EventDetailModal = () => {
    const [rsvps, setRsvps] = useState<any[] | null>(null);
    const [ownerName, setOwnerName] = useState<string | null>(null);
    if (modalType !== 'event' || !modalPayload) return null;
    const e = modalPayload;

    useEffect(() => {
      let mounted = true;
      (async () => {
        try {
          if (e.eventId) {
            const rr = await db.getRsvpsForEvent(e.eventId);
            if (mounted) setRsvps(rr || []);
          } else {
            setRsvps(null);
          }
          if (e.userId) {
            const u = await db.getUserById(e.userId);
            if (mounted) setOwnerName(u?.username ?? String(e.userId));
          } else {
            setOwnerName(null);
          }
        } catch (err) {
          // ignore
        }
      })();
      return () => { mounted = false; };
    }, [modalPayload]);

    return (
      <Modal visible={true} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: t.color.surface, padding: 16, borderRadius: 8, position: 'relative' }}>
            <Pressable onPress={closeModal} accessibilityLabel="Close event details" style={{ position: 'absolute', top: 8, right: 8, padding: 6, zIndex: 20 }}>
              <MaterialIcons name="close" size={20} color={t.color.textMuted} />
            </Pressable>
            <Text style={{ fontSize: 18, fontWeight: '700', color: t.color.text }}>{e.title ?? e.eventTitle ?? 'Event'}</Text>
            <Text style={{ color: t.color.textMuted, marginTop: 8 }}>{e.time ?? ''}</Text>
            {e.date ? <Text style={{ marginTop: 6, color: t.color.textMuted }}>Date: {String(e.date)}</Text> : null}
            {e.startTime ? <Text style={{ marginTop: 6, color: t.color.text }}>Start: {new Date(e.startTime).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}</Text> : null}
            {e.endTime ? <Text style={{ marginTop: 2, color: t.color.text }}>End: {new Date(e.endTime).toLocaleString([], { hour: '2-digit', minute: '2-digit' })}</Text> : null}
            {e.recurring ? <Text style={{ marginTop: 6, color: t.color.textMuted }}>Repeats: {e.recurring === 0 ? 'None' : e.recurring === 1 ? 'Daily' : e.recurring === 7 ? 'Weekly' : e.recurring === 30 ? 'Monthly' : String(e.recurring)}</Text> : null}
            {ownerName ? <Text style={{ marginTop: 6, color: t.color.textMuted }}>Created by: {ownerName}</Text> : null}
            {e.description ? <Text style={{ marginTop: 8, color: t.color.text }}>{e.description}</Text> : null}

            {rsvps && Array.isArray(rsvps) ? (
              <View style={{ marginTop: 10 }}>
                <Text style={{ fontWeight: '600', color: t.color.text }}>Attendees</Text>
                {rsvps.length === 0 ? <Text style={{ color: t.color.textMuted, marginTop: 4 }}>No RSVPs</Text> : rsvps.map((r: any) => (
                  <Text key={r.rsvpId} style={{ color: t.color.text, marginTop: 4 }}>{r.inviteRecipientId ? `User ${r.inviteRecipientId} — ${r.status}` : `ID:${r.rsvpId} — ${r.status}`}</Text>
                ))}
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
              {e.eventId ? <Button title="Delete" color="#d9534f" onPress={async () => {
                try {
                  await db.deleteEvent(e.eventId);
                  await loadData();
                  if (e && (e as any)._returnTo) {
                    const ret = (e as any)._returnTo;
                    // reopen the day list for the same date (fresh data)
                    setModalType(ret.type as any);
                    setModalPayload({ date: ret.payload.date, entries: dataByDate[ret.payload.date] || [] });
                  } else {
                    closeModal();
                  }
                } catch (err) {
                  // ignore
                  closeModal();
                }
              }} /> : null}
              {e.userId && e.userId === currentUserId ? <View style={{ width: 8 }} /> : null}
              {e.userId && e.userId === currentUserId ? <Button title="Edit" onPress={() => {
                // Open create modal in edit mode with the existing event
                const derivedDate = e.date || (e.startTime ? new Date(e.startTime).toISOString().slice(0,10) : undefined);
                // Carry along the return-to info so after editing we can go back if desired
                setModalPayload({ event: e, date: derivedDate, editMode: true, _returnTo: (e as any)._returnTo });
                setModalType('create');
              }} /> : null}
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  const DayListModal = () => {
    if (modalType !== 'list' || !modalPayload) return null;
    const date = modalPayload.date;
    const entries = modalPayload.entries ?? (dataByDate[date] || []);
    return (
      <Modal visible={true} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 12 }}>
          <View style={{ backgroundColor: t.color.surface, maxHeight: '80%', borderRadius: 8, padding: 12, position: 'relative' }}>
            <Pressable onPress={closeModal} accessibilityLabel="Close list" style={{ position: 'absolute', top: 8, right: 8, padding: 6, zIndex: 20 }}>
              <MaterialIcons name="close" size={20} color={t.color.textMuted} />
            </Pressable>
            <Text style={{ fontSize: 18, fontWeight: '700', color: t.color.text }}>Items on {date}</Text>
              <ScrollView style={{ marginTop: 8 }}>
              {entries.map((it: any, i: number) => {
                const colorForEntry = (owner?: string, kind?: string) => {
                  if (!owner && !kind) return t.color.accent;
                  if (owner === 'friend' && kind === 'event') return '#AF52DE';
                  if (owner === 'friend' && kind === 'free') return '#34C759';
                  if (owner === 'mine' && kind === 'event') return '#FF3B30';
                  if (owner === 'mine' && kind === 'free') return t.color.accent;
                  return t.color.accent;
                };
                const bg = colorForEntry(it.owner, it.kind);
                return (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.85}
                    onPress={() => { setModalPayload({ ...it, _returnTo: { type: 'list', payload: { date, entries } } }); setModalType('event'); }}
                    style={{ padding: 8, borderRadius: 8, marginBottom: 8, flexDirection: 'row', alignItems: 'center', backgroundColor: t.color.surface }}
                  >
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: bg, marginRight: 10 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.color.textMuted, fontSize: 12 }}>{it.time ?? ''}</Text>
                      <Text style={{ color: t.color.text, fontWeight: '600' }}>{it.title ?? it.eventTitle ?? it.name ?? ''}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    );
  };

  const CreateEventModal = () => {
    const date = modalPayload?.date ?? '';
    const [isEventToggle, setIsEventToggle] = useState<boolean>(true);
    const [title, setTitle] = useState<string>('');
    const [startHour, setStartHour] = useState<number>(9);
    const [startMinute, setStartMinute] = useState<number>(0);
    const [endHour, setEndHour] = useState<number>(10);
    const [endMinute, setEndMinute] = useState<number>(0);
    const [description, setDescription] = useState<string>('');
    const [recurringFreq, setRecurringFreq] = useState<'none'|'daily'|'weekly'|'monthly'>('none');

    useEffect(() => {
      if (modalType === 'create' && modalPayload) {
        // initialize defaults whenever modal opens
        const editing = !!modalPayload.editMode && modalPayload.event;
        if (editing) {
          const ev = modalPayload.event;
          setIsEventToggle(!(ev.isEvent === 0));
          setTitle(ev.eventTitle ?? ev.title ?? '');
          try {
            if (ev.startTime) {
              const sd = new Date(ev.startTime);
              if (!Number.isNaN(sd.getTime())) {
                setStartHour(sd.getHours());
                setStartMinute(sd.getMinutes());
              }
            }
            if (ev.endTime) {
              const ed = new Date(ev.endTime);
              if (!Number.isNaN(ed.getTime())) {
                setEndHour(ed.getHours());
                setEndMinute(ed.getMinutes());
              }
            }
          } catch (e) {
            // ignore
          }
          setDescription(ev.description ?? '');
          const rc = ev.recurring ?? 0;
          setRecurringFreq(rc === 0 ? 'none' : rc === 1 ? 'daily' : rc === 7 ? 'weekly' : rc === 30 ? 'monthly' : 'none');
        } else {
          setIsEventToggle(true);
          setTitle('');
          setStartHour(9);
          setStartMinute(0);
          setEndHour(10);
          setEndMinute(0);
          setDescription('');
          setRecurringFreq('none');
        }
      }
    }, [modalType, modalPayload]);

    const save = async () => {
      const pad = (n: number) => String(n).padStart(2, '0');
      const isoStart = `${date}T${pad(startHour)}:${pad(startMinute)}:00`;
      const isoEnd = `${date}T${pad(endHour)}:${pad(endMinute)}:00`;
      const recurringCode = recurringFreq === 'none' ? 0 : recurringFreq === 'daily' ? 1 : recurringFreq === 'weekly' ? 7 : 30;
      const editing = !!modalPayload?.editMode && modalPayload?.event;
      if (editing && modalPayload.event && modalPayload.event.eventId) {
        // update existing
        const eid = modalPayload.event.eventId;
        const fields: any = {};
        if (isEventToggle) {
          if (!title.trim()) return; // require title
          fields.eventTitle = title || 'Event';
          fields.description = description || null;
          fields.recurring = recurringCode;
          fields.isEvent = 1;
          fields.date = date || null;
        } else {
          fields.eventTitle = null;
          fields.description = null;
          fields.isEvent = 0;
          fields.date = date || null;
        }
        fields.startTime = isoStart;
        fields.endTime = isoEnd;
        await db.updateEvent(eid, fields);
      } else {
        if (isEventToggle) {
          if (!title.trim()) {
            // simple validation: require a title for events
            return;
          }
          if (currentUserId == null) {
            // Guard: user id not resolved yet
            // eslint-disable-next-line no-console
            console.warn('Calendar: save attempted but currentUserId is not resolved');
            return;
          }
          await db.createEvent({ userId: currentUserId, eventTitle: title || 'Event', description: description || undefined, startTime: isoStart, endTime: isoEnd, date, isEvent: 1, recurring: recurringCode });
        } else {
          if (currentUserId == null) {
            // eslint-disable-next-line no-console
            console.warn('Calendar: save attempted but currentUserId is not resolved');
            return;
          }
          await db.addFreeTime({ userId: currentUserId, startTime: isoStart, endTime: isoEnd });
        }
      }
      // After create/update, refresh data and return to the originating list if requested
      await loadData();
      const ret = (modalPayload as any)?._returnTo;
      if (ret) {
        setModalType(ret.type as any);
        setModalPayload({ date: ret.payload.date });
      } else {
        closeModal();
      }
    };

    if (modalType !== 'create' || !modalPayload) return null;

    return (
      <Modal visible={true} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={{ flex: 1, backgroundColor: '#00000088', justifyContent: 'center', padding: 12 }}>
          <View style={{ backgroundColor: t.color.surface, borderRadius: 10, overflow: 'hidden', maxHeight: '90%' }}>
            <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: '#eee', position: 'relative' }}>
              <Pressable onPress={closeModal} accessibilityLabel="Close create dialog" style={{ position: 'absolute', top: 8, right: 8, padding: 6, zIndex: 20 }}>
                <MaterialIcons name="close" size={20} color={t.color.textMuted} />
              </Pressable>
              <Text style={{ fontSize: 18, fontWeight: '700', color: t.color.text }}>{modalPayload?.editMode ? 'Edit' : 'Create'} on {date}</Text>
            </View>
            <ScrollView contentContainerStyle={{ padding: 14 }}>
              <View style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity onPress={() => setIsEventToggle(true)} style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: isEventToggle ? '#3A8DFF' : '#eee', marginRight: 8 }}>
                    <Text style={{ color: isEventToggle ? '#fff' : '#000', fontWeight: '600' }}>Event</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setIsEventToggle(false)} style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, backgroundColor: !isEventToggle ? '#3A8DFF' : '#eee' }}>
                    <Text style={{ color: !isEventToggle ? '#fff' : '#000', fontWeight: '600' }}>Free time</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {isEventToggle && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: t.color.text, marginBottom: 6 }}>Title</Text>
                  <TextInput value={title} onChangeText={setTitle} placeholder="Title" style={{ backgroundColor: '#fff', padding: 10, borderRadius: 6 }} />
                </View>
              )}

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={{ color: t.color.text, marginBottom: 6 }}>Start</Text>
                  <View style={{ backgroundColor: '#222', padding: 8, borderRadius: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TouchableOpacity onPress={() => setStartHour((startHour + 23) % 24)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>-</Text>
                        </TouchableOpacity>
                        <Text style={{ width: 36, textAlign: 'center', marginHorizontal: 8, color: '#fff' }}>{String(((startHour + 11) % 12) + 1).padStart(2, '0')}</Text>
                        <TouchableOpacity onPress={() => setStartHour((startHour + 1) % 24)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>+</Text>
                        </TouchableOpacity>
                        <Text style={{ marginHorizontal: 8, color: '#fff' }}>:</Text>
                        <TouchableOpacity onPress={() => setStartMinute((startMinute + 45) % 60)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>-</Text>
                        </TouchableOpacity>
                        <Text style={{ width: 36, textAlign: 'center', marginHorizontal: 8, color: '#fff' }}>{String(startMinute).padStart(2, '0')}</Text>
                        <TouchableOpacity onPress={() => setStartMinute((startMinute + 15) % 60)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>+</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={{ flexDirection: 'row', marginLeft: 8 }}>
                        <TouchableOpacity onPress={() => { if (startHour >= 12) setStartHour(startHour - 12); }} style={{ paddingVertical: 6, paddingHorizontal: 10, marginRight: 6, borderRadius: 6, backgroundColor: startHour < 12 ? '#3A8DFF' : '#eee' }}>
                          <Text style={{ color: startHour < 12 ? '#fff' : '#000' }}>AM</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => { if (startHour < 12) setStartHour((startHour + 12) % 24); }} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, backgroundColor: startHour >= 12 ? '#3A8DFF' : '#eee' }}>
                          <Text style={{ color: startHour >= 12 ? '#fff' : '#000' }}>PM</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </View>

                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={{ color: t.color.text, marginBottom: 6 }}>End</Text>
                  <View style={{ backgroundColor: '#222', padding: 8, borderRadius: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TouchableOpacity onPress={() => setEndHour((endHour + 23) % 24)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>-</Text>
                        </TouchableOpacity>
                        <Text style={{ width: 36, textAlign: 'center', marginHorizontal: 8, color: '#fff' }}>{String(((endHour + 11) % 12) + 1).padStart(2, '0')}</Text>
                        <TouchableOpacity onPress={() => setEndHour((endHour + 1) % 24)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>+</Text>
                        </TouchableOpacity>
                        <Text style={{ marginHorizontal: 8, color: '#fff' }}>:</Text>
                        <TouchableOpacity onPress={() => setEndMinute((endMinute + 45) % 60)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>-</Text>
                        </TouchableOpacity>
                        <Text style={{ width: 36, textAlign: 'center', marginHorizontal: 8, color: '#fff' }}>{String(endMinute).padStart(2, '0')}</Text>
                        <TouchableOpacity onPress={() => setEndMinute((endMinute + 15) % 60)} style={{ padding: 6, backgroundColor: '#333', borderRadius: 4 }}>
                          <Text style={{ color: '#fff' }}>+</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={{ flexDirection: 'row', marginLeft: 8 }}>
                        <TouchableOpacity onPress={() => { if (endHour >= 12) setEndHour(endHour - 12); }} style={{ paddingVertical: 6, paddingHorizontal: 10, marginRight: 6, borderRadius: 6, backgroundColor: endHour < 12 ? '#3A8DFF' : '#eee' }}>
                          <Text style={{ color: endHour < 12 ? '#fff' : '#000' }}>AM</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => { if (endHour < 12) setEndHour((endHour + 12) % 24); }} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, backgroundColor: endHour >= 12 ? '#3A8DFF' : '#eee' }}>
                          <Text style={{ color: endHour >= 12 ? '#fff' : '#000' }}>PM</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </View>
              </View>

              {isEventToggle && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: t.color.text, marginBottom: 6 }}>Description</Text>
                  <TextInput value={description} onChangeText={setDescription} placeholder="Description" multiline style={{ backgroundColor: '#fff', padding: 10, borderRadius: 6, minHeight: 80 }} />
                </View>
              )}

              {isEventToggle && (
                <View style={{ marginBottom: 6 }}>
                  <Text style={{ color: t.color.text, marginBottom: 6 }}>Repeat</Text>
                  <View style={{ flexDirection: 'row' }}>
                    {(['none','daily','weekly','monthly'] as const).map((opt) => (
                      <TouchableOpacity key={opt} onPress={() => setRecurringFreq(opt)} style={{ paddingVertical: 8, paddingHorizontal: 10, marginRight: 8, borderRadius: 6, backgroundColor: recurringFreq === opt ? '#3A8DFF' : '#eee' }}>
                        <Text style={{ color: recurringFreq === opt ? '#fff' : '#000' }}>{opt === 'none' ? 'None' : opt.charAt(0).toUpperCase() + opt.slice(1)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
            </ScrollView>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', padding: 12, borderTopWidth: 1, borderTopColor: '#eee' }}>
              <TouchableOpacity onPress={save} style={{ paddingVertical: 10, paddingHorizontal: 14, backgroundColor: t.color.accent, borderRadius: 8 }}>
                <Text style={{ color: '#fff' }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  // Reload when the screen regains focus (e.g., navigating back to the calendar)
  useFocusEffect(useCallback(() => {
    // refresh data when the screen is focused
    loadData();
    // no special cleanup required here
    return;
  }, [loadData]));

  // Fallback: also add a navigation listener in case some navigators don't
  // correctly trigger useFocusEffect in the environment (web / custom wrappers).
  // This ensures loadData is called when the screen receives focus.
  const navigationAny: any = useNavigation();
  useEffect(() => {
    if (!navigationAny || typeof navigationAny.addListener !== 'function') return;
    const unsubscribe = navigationAny.addListener('focus', () => {
      loadData();
    });
    return unsubscribe;
  }, [navigationAny, loadData]);

  // enable scrolling when the total rendered content is taller than the measured
  // available viewport height. Use the core rendered height (without extra
  // bottom pad) here so this calculation can run before the pad constant is
  // declared later in the file.
  const totalRenderedContentHeight = headerHeight + togglesHeight + totalCalendarHeight;
  const scrollEnabled = availableHeight == null ? true : (totalRenderedContentHeight > availableHeight);

  // compute safeCalendarHeight after knowing whether we'll allow scrolling
  // safeCalendarHeight: the height we actually pass to the Calendar UI.
  // - If scroll is enabled (we can't fit the grid) we let the Calendar render
  //   its full height (grid + chrome) so it can be scrolled.
  // - Otherwise we clamp the grid to the available grid space (minus a small
  //   buffer) and add back the calendar chrome height.
  const safeCalendarHeight = (() => {
    const buffer = 12; // small safety buffer for grid comparisons
    if (scrollEnabled) return totalCalendarHeight;
    if (availableForGrid == null) return totalCalendarHeight;
    const maxAllowedGrid = Math.max(availableForGrid - buffer, dayCellHeight);
    const gridToUse = Math.min(calendarGridHeight, maxAllowedGrid);
    return gridToUse + monthHeaderHeight + weekDayHeaderHeight;
  })();

  // compute a content minHeight so the ScrollView can scroll fully to the last row
  // keep a modest bottom pad so the final row isn't obscured
  const extraBottomPad = 96; // increased to ensure final row isn't obscured on small viewports
  const contentMinHeight = Math.max(
    // prefer the measured available height (when present) so devtools/resizing
    // which change the viewport don't create large empty gaps; fall back to
    // screenHeight when availableHeight is not yet measured.
    (availableHeight ?? windowSize.height) + extraBottomPad,
    // or the full content height (header + controls + calendar) + pad
    headerHeight + togglesHeight + totalCalendarHeight + extraBottomPad,
  );

  // No programmatic scrolling here — focus on accurate sizing math.

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.color.bg, padding: t.space.lg }}
      contentContainerStyle={{ paddingBottom: extraBottomPad, minHeight: contentMinHeight }}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        // log measured viewport/container height
        // Commented out to reduce console spam during normal dev
        // eslint-disable-next-line no-console
        // console.log('onLayout: ScrollView height: ' + JSON.stringify({ measuredHeight: h, availableHeight: Math.min(h, windowSize.height) }));
        // clamp the measured available height to the window height so we never trust inflated values
        setAvailableHeight(Math.min(h, windowSize.height));
      }}
      nestedScrollEnabled={true}
  // allow scrolling only when we need it (avoids extra scroll behavior when not necessary)
  scrollEnabled={scrollEnabled}
    >
      {/* --- Screen Header --- */}
      <Text
        style={{
          color: t.color.text,
          fontSize: t.font.h1,
          fontWeight: "600",
          marginBottom: t.space.md,
        }}
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
      >
        Calendar
      </Text>

      {/* --- Filter Toggles --- */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginBottom: t.space.md,
          flexWrap: "wrap", // allow wrapping on small screens
        }}
        onLayout={(e) => setTogglesHeight(e.nativeEvent.layout.height)}
      >
        <Text style={{ color: t.color.text, marginBottom: 6 }}>
          Select or Deselect Calendar Views:
        </Text>

        {/* Toggle My Availability */}
        <TouchableOpacity
          onPress={() => setShowMine(!showMine)}
          style={{
            marginRight: 10,
            paddingVertical: 6,
            paddingHorizontal: 10,
            borderRadius: 8,
          }}
        >
          <Text style={{ color: showMine ? "#3A8DFF" : t.color.textMuted }}>
            My Availability
          </Text>
        </TouchableOpacity>

        {/* Toggle Friends' Availability */}
        <TouchableOpacity
          onPress={() => setShowFriends(!showFriends)}
          style={{
            marginRight: 10,
            paddingVertical: 6,
            paddingHorizontal: 10,
            borderRadius: 8,
          }}
        >
          <Text style={{ color: showFriends ? "#34C759" : t.color.textMuted }}>
            Friends
          </Text>
        </TouchableOpacity>

        {/* Toggle My Events */}
        <TouchableOpacity
          onPress={() => setShowMyEvents(!showMyEvents)}
          style={{
            marginRight: 10,
            paddingVertical: 6,
            paddingHorizontal: 10,
            borderRadius: 8,
          }}
        >
          <Text style={{ color: showMyEvents ? "#FF3B30" : t.color.textMuted }}>
            My Events
          </Text>
        </TouchableOpacity>

        {/* Invited Events toggle removed */}

      </View>
  {/* spacer removed per request (programmatic scroll + padding remain) */}
      

      {/* --- Calendar Component --- */}
      <View onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          const h = e.nativeEvent.layout.height;
            // eslint-disable-next-line no-console
            // console.log('onLayout: Calendar container size: ' + JSON.stringify({ measuredWidth: w, measuredHeight: h, calendarWidth, calendarContainerHeight }));
            setCalendarWidth(w);
            setCalendarContainerHeight(h);
        }} style={{ width: '100%' }}>
        <Calendar
          // clamp calendar height to the safe computed value so it fits the viewport
          style={{ height: safeCalendarHeight }}
          dayComponent={renderDay} // Custom day renderer
          onVisibleMonthsChange={(months: any[]) => {
            if (!months || months.length === 0) return;
            const first = months[0];
            const y = Number(first.year) || new Date().getFullYear();
            const m = Number(first.month) || (new Date().getMonth() + 1);
            const monthIndex = m - 1;
            const w = computeWeeksForMonth(y, monthIndex);
            setRows(w);
            // eslint-disable-next-line no-console
            // console.log('onVisibleMonthsChange: ' + JSON.stringify({ year: y, month: m, rows: w }));
          }}
          theme={{
            monthTextColor: "#ffffff", // Month title color -> white
            dayTextColor: t.color.text, // Default day number color
            arrowColor: "#ffffff", // Month navigation arrows -> white
            backgroundColor: t.color.surface, // Calendar background
            calendarBackground: t.color.surface,
            textSectionTitleColor: t.color.text, // Weekday names
            textDisabledColor: t.color.textMuted, // Disabled days
            todayTextColor: "#FF9500", // Today highlight
            textMonthFontSize: 22,
            textMonthFontWeight: '700',
          }}
        />
      </View>
      {/* Detailed runtime diagnostics for layout math (console only). This
          prints a compact JSON object with all the measured and computed
          values used for sizing — helpful when tuning for different devices. */}
      {(() => {
        // Detailed layout diagnostics are commented out to reduce console noise.
        // Uncomment the following console.log during troubleshooting.
        // eslint-disable-next-line no-console
        // console.log('layout diagnostics: ' + JSON.stringify({
        //   windowWidth: windowSize.width,
        //   windowHeight: windowSize.height,
        //   calendarWidth,
        //   rawWidth,
        //   availableHeight,
        //   measuredViewportHeight,
        //   viewportReserve,
        //   headerHeight,
        //   togglesHeight,
        //   availableForGrid,
        //   rows,
        //   dayCellWidth,
        //   dayCellHeight: computedDayHeight,
        //   calendarGridHeight,
        //   totalCalendarHeight,
        //   topNavHeight,
        //   calendarContainerHeight,
        //   headerMarginBottom,
        //   togglesMarginBottom,
        //   scrollAffordanceMargin,
        //   scrollPaddingTop,
        //   scrollPaddingBottom,
        //   safeCalendarHeight,
        //   overflows: availableForGrid != null ? calendarGridHeight > availableForGrid : null,
        //   shrinkApplied,
        // }));
        return null;
      })()}
      {/* Modals rendered at top-level of this screen */}
      <EventDetailModal />
      <DayListModal />
      <CreateEventModal />
    </ScrollView>
  );
}
