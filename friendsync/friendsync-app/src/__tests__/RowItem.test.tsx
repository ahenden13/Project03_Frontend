import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import RowItem from '../components/RowItem';

// Mock the ThemeProvider hook
jest.mock('../lib/ThemeProvider', () => ({
  useTheme: () => ({
    color: {
      surface: '#1a1a1a',
      border: '#333333',
      textMuted: '#888888',
    },
    radius: {
      md: 8,
    },
  }),
}));

describe('RowItem', () => {
  it('renders title correctly', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <RowItem
        title="Hello"
        onPress={onPress}
        testID="row"
      />
    );

    expect(getByText('Hello')).toBeTruthy();
  });

  it('renders title and subtitle', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <RowItem
        title="Hello"
        subtitle="Sub"
        onPress={onPress}
        testID="row"
      />
    );

    expect(getByText('Hello')).toBeTruthy();
    expect(getByText('Sub')).toBeTruthy();
  });

  it('renders rightLabel when provided', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <RowItem
        title="Hello"
        rightLabel="Now"
        onPress={onPress}
        testID="row"
      />
    );

    expect(getByText('Hello')).toBeTruthy();
    expect(getByText('Now')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <RowItem
        title="Hello"
        onPress={onPress}
        testID="row"
      />
    );

    fireEvent.press(getByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders all props together', () => {
    const onPress = jest.fn();
    const { getByText, getByTestId } = render(
      <RowItem
        title="Hello"
        subtitle="Sub"
        rightLabel="Now"
        onPress={onPress}
        testID="row"
      />
    );

    expect(getByText('Hello')).toBeTruthy();
    expect(getByText('Sub')).toBeTruthy();
    expect(getByText('Now')).toBeTruthy();

    fireEvent.press(getByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not render subtitle when not provided', () => {
    const onPress = jest.fn();
    const { queryByText } = render(
      <RowItem
        title="Hello"
        onPress={onPress}
        testID="row"
      />
    );

    expect(queryByText('Sub')).toBeNull();
  });

  it('does not render rightLabel when not provided', () => {
    const onPress = jest.fn();
    const { queryByText } = render(
      <RowItem
        title="Hello"
        onPress={onPress}
        testID="row"
      />
    );

    expect(queryByText('Now')).toBeNull();
  });
});
