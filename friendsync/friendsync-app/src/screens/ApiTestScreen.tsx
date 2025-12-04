import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, TextInput } from 'react-native';

const API_BASE_URL = 'https://project03-friendsync-backend-8c893d18fe37.herokuapp.com';

interface ApiResponse {
  data: any;
  error: string | null;
  loading: boolean;
}

export default function ApiTestScreen() {
  // State for test user IDs
  const [testUserId, setTestUserId] = useState('');
  const [testEventId, setTestEventId] = useState('');

  // State for API responses
  const [usersResponse, setUsersResponse] = useState<ApiResponse>({ data: null, error: null, loading: false });
  const [loginResponse, setLoginResponse] = useState<ApiResponse>({ data: null, error: null, loading: false });
  const [friendsResponse, setFriendsResponse] = useState<ApiResponse>({ data: null, error: null, loading: false });
  const [eventsResponse, setEventsResponse] = useState<ApiResponse>({ data: null, error: null, loading: false });
  const [rsvpsResponse, setRsvpsResponse] = useState<ApiResponse>({ data: null, error: null, loading: false });
  const [prefsResponse, setPrefsResponse] = useState<ApiResponse>({ data: null, error: null, loading: false });

  // ==================== USER TESTS ====================
  
  const testGetAllUsers = async () => {
    setUsersResponse({ data: null, error: null, loading: true });
    try {
      const response = await fetch(`${API_BASE_URL}/api/users`);
      const data = await response.json();
      setUsersResponse({ data, error: null, loading: false });
      
      // this will auto-populate testUserId with first user if available
      if (Array.isArray(data) && data.length > 0 && data[0].id) {
        setTestUserId(data[0].id);
      }
    } catch (error) {
      setUsersResponse({ data: null, error: (error as Error).message, loading: false });
    }
  };

  const testLogin = async () => {
    setLoginResponse({ data: null, error: null, loading: true });
    try {
      const response = await fetch(`${API_BASE_URL}/api/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'testuser',
          password: 'testpass'
        })
      });
      const data = await response.json();
      setLoginResponse({ data, error: null, loading: false });
    } catch (error) {
      setLoginResponse({ data: null, error: (error as Error).message, loading: false });
    }
  };

  // ==================== FRIENDS TESTS ====================

  const testGetFriends = async () => {
    if (!testUserId) {
      setFriendsResponse({ data: null, error: 'Please enter a User ID first', loading: false });
      return;
    }
    setFriendsResponse({ data: null, error: null, loading: true });
    try {
      const response = await fetch(`${API_BASE_URL}/api/friends/user/${testUserId}`);
      const data = await response.json();
      setFriendsResponse({ data, error: null, loading: false });
    } catch (error) {
      setFriendsResponse({ data: null, error: (error as Error).message, loading: false });
    }
  };

  const testGetPendingFriendRequests = async () => {
    if (!testUserId) {
      setFriendsResponse({ data: null, error: 'Please enter a User ID first', loading: false });
      return;
    }
    setFriendsResponse({ data: null, error: null, loading: true });
    try {
      const response = await fetch(`${API_BASE_URL}/api/friends/pending/${testUserId}`);
      const data = await response.json();
      setFriendsResponse({ data, error: null, loading: false });
    } catch (error) {
      setFriendsResponse({ data: null, error: (error as Error).message, loading: false });
    }
  };

  // ==================== EVENTS TESTS ====================

  const testGetUserEvents = async () => {
    if (!testUserId) {
      setEventsResponse({ data: null, error: 'Please enter a User ID first', loading: false });
      return;
    }
    setEventsResponse({ data: null, error: null, loading: true });
    try {
      const response = await fetch(`${API_BASE_URL}/api/events/user/${testUserId}`);
      const data = await response.json();
      setEventsResponse({ data, error: null, loading: false });
      
      // Auto-populate testEventId with first event if available
      if (Array.isArray(data) && data.length > 0 && data[0].eventId) {
        setTestEventId(data[0].eventId);
      }
    } catch (error) {
      setEventsResponse({ data: null, error: (error as Error).message, loading: false });
    }
  };

  const testGetAllEvents = async () => {
    setEventsResponse({ data: null, error: null, loading: true });
    try {
      const response = await fetch(`${API_BASE_URL}/api/events`);
      const data = await response.json();
      setEventsResponse({ data, error: null, loading: false });
    } catch (error) {
      setEventsResponse({ data: null, error: (error as Error).message, loading: false });
    }
  };

  const testGetEventsByType = async () => {
    setEventsResponse({ data: null, error: null, loading: true });
    try {
      // true = actual events, false = free time blocks
      const response = await fetch(`${API_BASE_URL}/api/events/type/true`);
      const data = await response.json();
      setEventsResponse({ data, error: null, loading: false });
    } catch (error) {
      setEventsResponse({ data: null, error: (error as Error).message, loading: false });
    }
  };

  // ==================== RSVPS TESTS ====================

  const testGetUserRsvps = async () => {
    if (!testUserId) {
      setRsvpsResponse({ data: null, error: 'Please enter a User ID first', loading: false });
      return;
    }
    setRsvpsResponse({ data: null, error: null, loading: true });
    try {
      const response = await fetch(`${API_BASE_URL}/api/rsvps/user/${testUserId}`);
      const data = await response.json();
      setRsvpsResponse({ data, error: null, loading: false });
    } catch (error) {
      setRsvpsResponse({ data: null, error: (error as Error).message, loading: false });
    }
  };

  const testGetPendingRsvps = async () => {
    if (!testUserId) {
      setRsvpsResponse({ data: null, error: 'Please enter a User ID first', loading: false });
      return;
    }
    setRsvpsResponse({ data: null, error: null, loading: true });
    try {
      const response = await fetch(`${API_BASE_URL}/api/rsvps/user/${testUserId}/pending`);
      const data = await response.json();
      setRsvpsResponse({ data, error: null, loading: false });
    } catch (error) {
      setRsvpsResponse({ data: null, error: (error as Error).message, loading: false });
    }
  };

  const testGetEventRsvpSummary = async () => {
    if (!testEventId) {
      setRsvpsResponse({ data: null, error: 'Please enter an Event ID first', loading: false });
      return;
    }
    setRsvpsResponse({ data: null, error: null, loading: true });
    try {
      const response = await fetch(`${API_BASE_URL}/api/rsvps/event/${testEventId}/summary`);
      const data = await response.json();
      setRsvpsResponse({ data, error: null, loading: false });
    } catch (error) {
      setRsvpsResponse({ data: null, error: (error as Error).message, loading: false });
    }
  };

  // ==================== USER PREFERENCES TESTS ====================

  const testGetUserPreferences = async () => {
    if (!testUserId) {
      setPrefsResponse({ data: null, error: 'Please enter a User ID first', loading: false });
      return;
    }
    setPrefsResponse({ data: null, error: null, loading: true });
    try {
      const response = await fetch(`${API_BASE_URL}/api/user-prefs/user/${testUserId}`);
      const data = await response.json();
      setPrefsResponse({ data, error: null, loading: false });
    } catch (error) {
      setPrefsResponse({ data: null, error: (error as Error).message, loading: false });
    }
  };

  // ==================== HELPER FUNCTIONS ====================

  const renderResponse = (response: ApiResponse, title: string) => (
    <View style={styles.responseContainer}>
      <Text style={styles.responseTitle}>{title}</Text>
      {response.loading && <ActivityIndicator size="small" color="#007AFF" />}
      {response.error && <Text style={styles.errorText}>Error: {response.error}</Text>}
      {response.data && (
        <View style={styles.dataContainer}>
          <Text style={styles.dataText}>{JSON.stringify(response.data, null, 2)}</Text>
        </View>
      )}
    </View>
  );

  // amazing claude styling with the typical AI emojis lol
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Calendar API Test Screen</Text>
      <Text style={styles.subheader}>Backend: {API_BASE_URL}</Text>

      {/* Input Fields */}
      <View style={styles.inputSection}>
        <Text style={styles.inputLabel}>Test User ID:</Text>
        <TextInput
          style={styles.input}
          value={testUserId}
          onChangeText={setTestUserId}
          placeholder="Enter user ID for testing"
          placeholderTextColor="#999"
        />
        
        <Text style={styles.inputLabel}>Test Event ID:</Text>
        <TextInput
          style={styles.input}
          value={testEventId}
          onChangeText={setTestEventId}
          placeholder="Enter event ID for testing"
          placeholderTextColor="#999"
        />
      </View>

      {/* USER TESTS */}
      <Text style={styles.sectionHeader}>👤 Users</Text>
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.button} onPress={testGetAllUsers}>
          <Text style={styles.buttonText}>GET All Users</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={testLogin}>
          <Text style={styles.buttonText}>POST Login</Text>
        </TouchableOpacity>
      </View>
      {renderResponse(usersResponse, 'Users Response')}
      {renderResponse(loginResponse, 'Login Response')}

      {/* FRIENDS TESTS */}
      <Text style={styles.sectionHeader}>👥 Friends</Text>
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.button} onPress={testGetFriends}>
          <Text style={styles.buttonText}>GET User's Friends</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={testGetPendingFriendRequests}>
          <Text style={styles.buttonText}>GET Pending Requests</Text>
        </TouchableOpacity>
      </View>
      {renderResponse(friendsResponse, 'Friends Response')}

      {/* EVENTS TESTS */}
      <Text style={styles.sectionHeader}>📅 Events</Text>
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.button} onPress={testGetUserEvents}>
          <Text style={styles.buttonText}>GET User's Events</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={testGetAllEvents}>
          <Text style={styles.buttonText}>GET All Events</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={testGetEventsByType}>
          <Text style={styles.buttonText}>GET Events by Type</Text>
        </TouchableOpacity>
      </View>
      {renderResponse(eventsResponse, 'Events Response')}

      {/* RSVPS TESTS */}
      <Text style={styles.sectionHeader}>✉️ RSVPs</Text>
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.button} onPress={testGetUserRsvps}>
          <Text style={styles.buttonText}>GET User's RSVPs</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={testGetPendingRsvps}>
          <Text style={styles.buttonText}>GET Pending RSVPs</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={testGetEventRsvpSummary}>
          <Text style={styles.buttonText}>GET Event RSVP Summary</Text>
        </TouchableOpacity>
      </View>
      {renderResponse(rsvpsResponse, 'RSVPs Response')}

      {/* USER PREFERENCES TESTS */}
      <Text style={styles.sectionHeader}>⚙️ User Preferences</Text>
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.button} onPress={testGetUserPreferences}>
          <Text style={styles.buttonText}>GET User Preferences</Text>
        </TouchableOpacity>
      </View>
      {renderResponse(prefsResponse, 'User Preferences Response')}

      <View style={{ height: 50 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    marginTop: 40,
    color: '#333',
  },
  subheader: {
    fontSize: 11,
    color: '#666',
    marginBottom: 20,
  },
  inputSection: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 5,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#f9f9f9',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    padding: 10,
    fontSize: 14,
    color: '#333',
  },
  sectionHeader: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 10,
    color: '#333',
  },
  buttonContainer: {
    marginBottom: 15,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  responseContainer: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  responseTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 14,
  },
  dataContainer: {
    backgroundColor: '#f9f9f9',
    padding: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ddd',
    maxHeight: 300,
  },
  dataText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#333',
  },
});