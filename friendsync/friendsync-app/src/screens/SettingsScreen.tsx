// src/screens/SettingsScreen.tsx

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Screen from '../components/ScreenTmp';
import { useTheme } from '../lib/ThemeProvider';
import { Calendar } from 'react-native-big-calendar';

// added 
import { auth } from "../lib/firebase";
import { useAuth } from "../features/auth/AuthProvider";


/* 
IMPORTANT NOTE (from alana): 
React Native Big Calendar always uses real Date objects to anchor its week view,
it wasn’t built specifically for “recurring availability” views.
That means it will always display the date numbers (e.g., “Sun 2”, “Mon 3”, etc.), 
because it’s trying to be a real calendar.
But, the week view always updates to the current week automatically.


*/ 

// Helper: get Sunday of the current week (for fixed weekly view)
const getStartOfWeek = (date: Date) => {
  const start = new Date(date);
  const day = start.getDay(); // 0 = Sunday
  start.setDate(start.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return start;
};

// Helper: add days to a given date
const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

export default function SettingsScreen() {
  const t = useTheme();

  //Determine start & end of fixed week (Sunday → Saturday)
  const today = new Date();
  const weekStart = getStartOfWeek(today);
  const weekEnd = addDays(weekStart, 6);

  // Dummy recurring "Free Time" availability blocks
  // You can imagine these being saved to backend later
  const dummyAvailability = useMemo(
    () => [
      {
        title: 'Morning Free Time',
        start: new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 1, 9, 0),
        end: new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 1, 12, 0),
      },
      {
        title: 'Evening Free Time',
        start: new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 3, 18, 0),
        end: new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 3, 21, 0),
      },
      {
        title: 'Weekend Free Time',
        start: new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6, 10, 0),
        end: new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6, 14, 0),
      },
    ],
    [weekStart]
  );

  // Style for availability blocks (blue, like HomeScreen)
  const eventCellStyle = {
    backgroundColor: t.color.accent,
  };

  // Default scroll position to start near morning hours
  const scrollOffsetMinutes = 8 * 60; // 8 AM

  return (
    <Screen>
      {/* Page Header */}
      <Text
        style={{
          color: t.color.text,
          fontSize: t.font.h1,
          fontWeight: '700',
          marginBottom: t.space.sm,
        }}
      >
        User Settings
      </Text>
      <Text style={{ color: t.color.textMuted, marginTop: t.space.sm }}> 
        Settings will go here. Includes potentially username, password and contact info Theme selection, notification preferences Landing Page display options and anything else we think of 
      </Text>
      <br />
      <Text style={{ color: t.color.textMuted, marginBottom: t.space.md }}>
        Adjust your account preferences and recurring weekly availability.
      </Text>

      {/* Subsection Title */}
      <Text
        style={{
          color: t.color.text,
          fontSize: t.font.h2,
          fontWeight: '600',
          marginBottom: t.space.sm,
        }}
      >
        Weekly Availability
      </Text>

      <Text style={{ color: t.color.textMuted, marginBottom: t.space.md }}>
        This calendar reflects your recurring free time for a typical week.
        Future updates will let you edit and save it to your profile.
      </Text>

      {/* Edit Availability Button (non-functional*** placeholder) */}
      <TouchableOpacity
        onPress={() => console.log('Edit availability pressed')}
        activeOpacity={0.7}
      >
        <Text style = {{color: t.color.text}}>Edit Availability</Text>
      </TouchableOpacity>

      {/* Calendar Component */}
      <View style={{ height: 550 }}>
        <Calendar
          events={dummyAvailability} // show free time blocks
          date={weekStart} // fixed week (Sunday–Saturday)
          height={500}
          mode="week"
          scrollOffsetMinutes={scrollOffsetMinutes}
          eventCellStyle={eventCellStyle}
          swipeEnabled={false} // no week navigation
          showTime={true}
          headerContainerStyle={{
            backgroundColor: 'transparent',
          }}
          hourStyle={{ color: t.color.textMuted }}
        />
      </View>
      {/* --- Sign Out Section --- */}
      <View style={{ marginTop: 32, alignItems: "center" }}>
        <Text style={{ color: t.color.textMuted, marginBottom: 8 }}>
          Signed in as {useAuth().user?.email}
        </Text>

        <TouchableOpacity
          onPress={() => {
            auth.signOut();
            console.log("[Auth] User signed out");
          }}
          activeOpacity={0.7}
          style={{
            backgroundColor: "#b91c1c",
            paddingVertical: 10,
            paddingHorizontal: 20,
            borderRadius: 8,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </Screen>
  );
}
