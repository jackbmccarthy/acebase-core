function runCallback(callback: (data: any) => void, data: any) {
    try {
        callback(data);
    }
    catch (err) {
        console.error('Error in subscription callback', err);
    }
}
export class SimpleEventEmitter {
    private _subscriptions: { event: string, callback: (data: any) => void, once: boolean }[];
    private _oneTimeEvents: Map<string, any>;
    constructor() {
        this._subscriptions = [];
        this._oneTimeEvents = new Map();
    }
    on<T = any>(event: string, callback: (data: T) => void) {
        if (this._oneTimeEvents.has(event)) {
            return runCallback(callback, this._oneTimeEvents.get(event));
        }
        this._subscriptions.push({ event, callback, once: false });
        return this;
    }
    off<T = any>(event: string, callback?: (data: T) => void) {
        this._subscriptions = this._subscriptions.filter(s => s.event !== event || (callback && s.callback !== callback));
        return this;
    }
    once<T = any>(event: string, callback?: (data: T) => void): Promise<T> {
        return new Promise<T>(resolve => {
            const ourCallback = (data: T) => {
                resolve(data);
                callback?.(data);
            };
            if (this._oneTimeEvents.has(event)) {
                runCallback(ourCallback, this._oneTimeEvents.get(event));
            }
            else {
                this._subscriptions.push({ event, callback: ourCallback, once: true });
            }
        });
    }
    emit(event: string, data?: any) {
        if (this._oneTimeEvents.has(event)) { throw new Error(`Event "${event}" was supposed to be emitted only once`); }
        for (let i = 0; i < this._subscriptions.length; i++) {
            const s = this._subscriptions[i];
            if (s.event !== event) { continue; }
            runCallback(s.callback, data);
            if (s.once) {
                this._subscriptions.splice(i, 1);
                i--;
            }
        }
        return this;
    }
    emitOnce(event: string, data?: any) {
        if (this._oneTimeEvents.has(event)) { throw new Error(`Event "${event}" was supposed to be emitted only once`); }
        this.emit(event, data);
        this._oneTimeEvents.set(event, data); // Mark event as being emitted once for future subscribers
        this.off(event); // Remove all listeners for this event, they won't fire again
        return this;
    }
}
