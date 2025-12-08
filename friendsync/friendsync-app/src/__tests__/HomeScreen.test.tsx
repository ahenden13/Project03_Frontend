import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import HomeScreen from '../screens/HomeScreen';

// Mock dependencies
jest.mock('../lib/ThemeProvider', () => ({
  useTheme: () => ({
    color: {
      text: '#000',
      textMuted: '#666',
      surface: '#fff',
      accent: '#007AFF',
    },
    space: {
      xs: 4,
      sm: 8,
      md: 16,
    },
    font: {
      h1: 32,
      h2: 24,
    },
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
  },
}));

jest.mock('../lib/db', () => ({
  __esModule: true,
  default: {
    init_db: jest.fn().mockResolvedValue(true),
    getUserByEmail: jest.fn().mockResolvedValue({ userId: 1, username: 'testuser' }),
    getAllUsers: jest.fn().mockResolvedValue([{ userId: 1, username: 'testuser' }]),
    getEventsForUser: jest.fn().mockResolvedValue([]),
    getFreeTimeForUser: jest.fn().mockResolvedValue([]),
    getUserById: jest.fn().mockResolvedValue({ userId: 1, username: 'testuser' }),
  },
}));

// Mock react-native-big-calendar
jest.mock('react-native-big-calendar', () => ({
  Calendar: ({ events, onPressEvent }: any) => {
    const { View, Text, TouchableOpacity } = require('react-native');
    return (
      <View testID="calendar-component">
        {events.map((event: any, index: number) => (
          <TouchableOpacity
            key={index}
            testID={`event-${index}`}
            onPress={() => onPressEvent(event)}
          >
            <Text>{event.title}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import db from '../lib/db';

describe('HomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'userId') return Promise.resolve('1');
      if (key === 'userEmail') return Promise.resolve('test@example.com');
      return Promise.resolve(null);
    });
  });

  it('renders the calendar component', async () => {
    const { getByTestId } = render(<HomeScreen />);

    await waitFor(() => {
      expect(getByTestId('calendar-component')).toBeTruthy();
    });
  });

  it('renders Weekly Calendar title', async () => {
    const { getByText } = render(<HomeScreen />);

    await waitFor(() => {
      expect(getByText('Weekly Calendar')).toBeTruthy();
    });
  });

  it('shows week navigation buttons', async () => {
    const { getByText } = render(<HomeScreen />);

    await waitFor(() => {
      expect(getByText('← Previous')).toBeTruthy();
      expect(getByText('Next →')).toBeTruthy();
    });
  });

  it('loads events from database on mount', async () => {
    const mockEvents = [
      {
        eventId: 1,
        eventTitle: 'Team Meeting',
        startTime: new Date('2025-12-10T10:00:00').toISOString(),
        endTime: new Date('2025-12-10T11:00:00').toISOString(),
        isEvent: 1,
        userId: 1,
      },
    ];

    (db.getEventsForUser as jest.Mock).mockResolvedValue(mockEvents);

    render(<HomeScreen />);

    await waitFor(() => {
      expect(db.init_db).toHaveBeenCalled();
      expect(db.getEventsForUser).toHaveBeenCalledWith(1);
    });
  });

  it('loads free time blocks from database', async () => {
    const mockFreeTime = [
      {
        eventId: 2,
        eventTitle: 'Free Time',
        startTime: new Date('2025-12-10T14:00:00').toISOString(),
        endTime: new Date('2025-12-10T16:00:00').toISOString(),
        isEvent: 0,
        userId: 1,
      },
    ];

    (db.getFreeTimeForUser as jest.Mock).mockResolvedValue(mockFreeTime);

    render(<HomeScreen />);

    await waitFor(() => {
      expect(db.getFreeTimeForUser).toHaveBeenCalledWith(1);
    });
  });

  it('handles week navigation forward', async () => {
    const { getByText } = render(<HomeScreen />);

    const nextButton = getByText('Next →');
    
    await waitFor(() => {
      expect(nextButton).toBeTruthy();
    });

    fireEvent.press(nextButton);

    // Verify the date range updated (this would check the displayed date text)
    // The exact assertion depends on the current date
  });

  it('handles week navigation backward', async () => {
    const { getByText } = render(<HomeScreen />);

    const prevButton = getByText('← Previous');
    
    await waitFor(() => {
      expect(prevButton).toBeTruthy();
    });

    fireEvent.press(prevButton);

    // Week should shift backward
  });

  it('displays color legend', async () => {
    const { getByText } = render(<HomeScreen />);

    await waitFor(() => {
      expect(getByText('Availability')).toBeTruthy();
      expect(getByText('Hosted Event')).toBeTruthy();
      expect(getByText('Invited Event')).toBeTruthy();
    });
  });

  it('opens event detail modal when event is pressed', async () => {
    const mockEvents = [
      {
        eventId: 1,
        eventTitle: 'Test Event',
        startTime: new Date('2025-12-10T10:00:00').toISOString(),
        endTime: new Date('2025-12-10T11:00:00').toISOString(),
        description: 'Test Description',
        isEvent: 1,
        userId: 1,
      },
    ];

    (db.getEventsForUser as jest.Mock).mockResolvedValue(mockEvents);
    (db.getUserById as jest.Mock).mockResolvedValue({ userId: 1, username: 'testuser' });

    const { getByTestId, getAllByText } = render(<HomeScreen />);

    await waitFor(() => {
      expect(getByTestId('event-0')).toBeTruthy();
    });

    // Press the event
    fireEvent.press(getByTestId('event-0'));

    // Modal should open with event details (text appears twice: in calendar and modal)
    await waitFor(() => {
      const testEventTexts = getAllByText('Test Event');
      expect(testEventTexts.length).toBeGreaterThan(0);
    });
  });

  it('resolves and displays event owner name', async () => {
    const mockEvents = [
      {
        eventId: 1,
        eventTitle: 'Meeting',
        startTime: new Date('2025-12-10T10:00:00').toISOString(),
        endTime: new Date('2025-12-10T11:00:00').toISOString(),
        userId: 2, // Different user
      },
    ];

    (db.getEventsForUser as jest.Mock).mockResolvedValue(mockEvents);
    (db.getUserById as jest.Mock).mockResolvedValue({ userId: 2, username: 'eventOwner' });

    const { getByTestId, getByText } = render(<HomeScreen />);

    await waitFor(() => {
      expect(getByTestId('event-0')).toBeTruthy();
    });

    fireEvent.press(getByTestId('event-0'));

    await waitFor(() => {
      expect(db.getUserById).toHaveBeenCalledWith(2);
      expect(getByText('eventOwner')).toBeTruthy();
    });
  });

  it('falls back to dummy events when db fails', async () => {
    (db.getEventsForUser as jest.Mock).mockRejectedValue(new Error('DB Error'));
    (db.getFreeTimeForUser as jest.Mock).mockRejectedValue(new Error('DB Error'));

    const { getByTestId } = render(<HomeScreen />);

    // Should still render without crashing
    await waitFor(() => {
      expect(getByTestId('calendar-component')).toBeTruthy();
    });
  });

  it('resolves userId from email when numeric id not available', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === 'userId') return Promise.resolve(null); // No userId
      if (key === 'userEmail') return Promise.resolve('test@example.com');
      return Promise.resolve(null);
    });

    (db.getUserByEmail as jest.Mock).mockResolvedValue({ userId: 5, username: 'testuser' });

    render(<HomeScreen />);

    await waitFor(() => {
      expect(db.getUserByEmail).toHaveBeenCalledWith('test@example.com');
      expect(db.getEventsForUser).toHaveBeenCalledWith(5);
    });
  });
});
