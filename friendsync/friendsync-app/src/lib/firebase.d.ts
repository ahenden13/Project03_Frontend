// Lightweight declaration to satisfy TypeScript module resolution for the
// platform-aggregating `src/lib/firebase.ts` helper. The real implementations
// are provided by `firebase.web.ts` and `firebase.native.ts` at runtime.

export const auth: any;
export const db: any;

declare const _default: { auth: any; db: any };
export default _default;
