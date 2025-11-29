// src/lib/theme.ts

export type Theme = {
  color: {
    bg: string;          // main app background
    surface: string;     // cards / top bars
    surfaceAlt: string;  // hover / pressed
    text: string;        // primary text
    textMuted: string;   // secondary text
    border: string;      // hairlines
    accent: string;      // subtle highlight / underline
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
  };
  space: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
  font: {
    h1: number;
    h2: number;
    body: number;
    label: number;
  };
  shadow: {
    sm: any;
    md: any;
  };
};

export const defaultTheme: Theme = { // this is just grey scale for now - based on the diagram
  color: {
    bg: '#121212',          // near-black // might be too dark?
    surface: '#1f1f1f',     // dark grey
    surfaceAlt: '#2c2c2c',  // hover/pressed
    text: '#e0e0e0',        // soft white
    textMuted: '#bdbdbd',   // muted grey
    border: '#2c2c2c',      // divider
    accent: '#3A8DFF',      // primary accent (blue)
  },
  radius: { sm: 6, md: 10, lg: 14 },
  space:  { xs: 6, sm: 10, md: 16, lg: 24, xl: 32 },
  font:   { h1: 24, h2: 20, body: 16, label: 14 },
  shadow: {
    sm: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
    md: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  },
};