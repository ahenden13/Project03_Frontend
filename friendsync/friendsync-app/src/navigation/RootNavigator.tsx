import { createStackNavigator } from '@react-navigation/stack';
import HomeScreen from '../screens/HomeScreen';
import CalendarScreen from '../screens/CalendarScreen';
import EventsScreen from '../screens/EventsScreen';
import FriendsScreen from '../screens/FriendsScreen';
import AuthScreen from '../screens/AuthScreen';
import TopNav from '../components/TopNav';
import AccountCreationScreen from '../screens/AccountCreationScreen';
import SettingsScreen from '../screens/SettingsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import WelcomeScreen from '../screens/WelcomeScreen';
import ApiTestScreen from '../screens/ApiTestScreen';
import DedupeDebugScreen from '../screens/DedupeDebugScreen';

// auth hook
import { useAuth } from '../features/auth/AuthProvider';

const Stack = createStackNavigator();

export default function RootNavigator() {
  const { user } = useAuth(); // null until signed in

  return (
    <Stack.Navigator
      // apply TopNav as global header
      screenOptions={{
        header: (props) => <TopNav {...props} />,
      }}
    >
      {/*  show ONLY Auth screen until signed in -justin */}
      {!user ? (
        <Stack.Screen
          name="Auth"
          component={AuthScreen}
          options={{ title: 'Authentication' }}
        />
      ) : (
        <>
          {/* Main app screens */}
          <Stack.Screen
            name="Welcome"
            component={WelcomeScreen}
            options={{ title: 'Welcome' }}
          />
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ title: 'Home' }}
          />
          <Stack.Screen
            name="Calendar"
            component={CalendarScreen}
            options={{ title: 'Calendar' }}
          />
          <Stack.Screen
            name="Events"
            component={EventsScreen}
            options={{ title: 'Events' }}
          />
          <Stack.Screen
            name="Friends"
            component={FriendsScreen}
            options={{ title: 'Friends' }}
          />
          {/* Placeholder for future login/register */}
          <Stack.Screen
            name="AccountCreation"
            component={AccountCreationScreen}
            options={{ title: 'Account Creation' }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: 'Settings' }}
          />
          {__DEV__ ? <Stack.Screen name="DedupeDebug" component={DedupeDebugScreen} options={{ title: 'Dedupe Debug' }} /> : null}
          <Stack.Screen
            name="Notifications"
            component={NotificationsScreen}
            options={{ title: 'Notifications' }}
          />
          <Stack.Screen 
            name="ApiTest" 
            component={ApiTestScreen}
            options={{ title: 'API Test' }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}
