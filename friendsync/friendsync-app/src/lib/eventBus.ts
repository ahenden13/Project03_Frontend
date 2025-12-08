type Handler = (payload?: any) => void;

const handlers: { [event: string]: Set<Handler> } = {};

export function on(event: string, handler: Handler) {
  if (!handlers[event]) handlers[event] = new Set();
  handlers[event].add(handler);
  return () => off(event, handler);
}

export function off(event: string, handler: Handler) {
  if (!handlers[event]) return;
  handlers[event].delete(handler);
  if (handlers[event].size === 0) delete handlers[event];
}

export function emit(event: string, payload?: any) {
  if (!handlers[event]) return;
  for (const h of Array.from(handlers[event])) {
    try { h(payload); } catch (e) { /* ignore handler errors */ }
  }
}

export default { on, off, emit };
