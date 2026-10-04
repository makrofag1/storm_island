// Minimal pub/sub bus used to decouple systems (combat -> audio/ui/ai, etc).
export class EventBus {
  constructor() { this.handlers = new Map(); }
  on(type, fn) {
    let list = this.handlers.get(type);
    if (!list) { list = []; this.handlers.set(type, list); }
    list.push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const list = this.handlers.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  emit(type, data) {
    const list = this.handlers.get(type);
    if (!list || list.length === 0) return;
    for (let i = 0; i < list.length; i++) list[i](data);
  }
  clear() { this.handlers.clear(); }
}
