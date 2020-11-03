// Use these imports when running tsc:
// import { DataReference } from './data-reference';
// import { DataSnapshot } from './data-snapshot';
// import { PathInfo } from './path-info';
// import { PathReference } from './path-reference';

// Use this import when editing:
// Not needed anymore once above files have been ported to Typescript
import { DataReference, DataSnapshot, PathInfo, PathReference } from '../index';

export class LiveDataProxy {
    /**
     * Creates a live data proxy for the given reference. The data of the reference's path will be loaded, and kept in-sync
     * with live data by listening for 'mutated' events. Any changes made to the value by the client will be synced back
     * to the database.
     * @param ref DataReference to create proxy for.
     * @example
     * const ref = db.ref('chats/chat1');
     * const proxy = await ref.proxy();
     * const chat = proxy.value;
     * console.log(`Got chat "${chat.title}":`, chat);
     * // chat: { message: 'This is an example chat', members: ['Ewout'], messages: { message1: { from: 'Ewout', text: 'Welcome to the proxy chat example' } } }
     * 
     * // Change title:
     * chat.title = 'Changing the title in the database too!';
     * 
     * // Add participants to the members array:
     * chat.members.push('John', 'Jack', 'Pete');
     * 
     * // Add a message to the messages collection (NOTE: automatically generates an ID)
     * chat.messages.push({ from: 'Ewout', message: 'I am changing the database without programming against it!' });
     */
    static async create(ref: DataReference) {
        let cache, loaded = false;
        const proxyId = ref.push().key;
        let onMutationCallback: ProxyObserveMutationsCallback;
        let onErrorCallback: ProxyObserveErrorCallback = err => {
            console.error(err.message, err.details);
        };

        // Subscribe to mutated events on the target path
        const subscription = ref.on('mutated').subscribe(async (mutationSnap: DataSnapshot) => {
            if (!loaded) { 
                return; 
            }
            const context = mutationSnap.ref.context();
            const remoteChange = context.proxy_id !== proxyId;
            let reloadCache = false;
            if (remoteChange) {
                // Make changes to cached object
                const mutatedPath = snap.ref.path;
                const trailPath = mutatedPath.slice(ref.path.length);
                const trailKeys = PathInfo.getPathKeys(trailPath);
                let target = cache;
                while (trailKeys.length > 1) {
                    const key = trailKeys.shift();
                    if (!(key in target)) {
                        // Have we missed an event, or are local pending mutations creating this conflict?
                        // Do not proceed, reload entire value into cache
                        reloadCache = true;
                        console.warn(`Cached value appears outdated, will be reloaded`);
                        break;
                        // target[key] = typeof trailKeys[0] === 'number' ? [] : {}
                    }
                    target = target[key];
                }
                if (!reloadCache) {
                    const prop = trailKeys.shift();
                    const newValue = snap.val();
                    if (newValue === null) {
                        // Remove it
                        target instanceof Array ? target.splice(prop as number, 1) : delete target[prop];                    
                    }
                    else {
                        // Set or update it
                        target[prop] = newValue;
                    }
                }
            }
            if (reloadCache) {
                const newSnap = await ref.get();
                // Remove all children of cache object, to keep the same reference
                Object.keys(cache).forEach(key => delete cache[key]);
                // Set new properties
                const newCache = newSnap.val();
                Object.keys(newCache).forEach(key => cache[key] = newCache[key]);
                // Set mutationSnap to our new value snapshot, with the original context
                newSnap.ref.context(mutationSnap.ref.context());
                mutationSnap = newSnap;
            }
            onMutationCallback && onMutationCallback(mutationSnap, remoteChange);
        })

        // Setup updating functionality: enqueue all updates, process them at next tick in the order they were issued 
        let processQueueTimeout, processPromise:Promise<any> = Promise.resolve();
        const overwriteQueue:Array<string|number>[] = [];
        const flagOverwritten = (target: Array<string|number>) => {
            // flag target for overwriting, if an ancestor (or itself) has not been already.
            // it will remove the flag for any descendants target previously set
            const ancestorOrSelf = overwriteQueue.find(otherTarget => otherTarget.length <= target.length && otherTarget.every((key,i) => key === target[i]));
            if (ancestorOrSelf) { return; }
            // remove ancestors
            const descendants = overwriteQueue.filter(otherTarget => otherTarget.length > target.length && otherTarget.every((key,i) => key === target[i]));
            descendants.forEach(d => overwriteQueue.splice(descendants.indexOf(d), 1));
            // add to the queue
            overwriteQueue.push(target);
            // schedule database updates
            if (!processQueueTimeout) {
                processQueueTimeout = setTimeout(() => {
                    const targets = overwriteQueue.splice(0);
                    // Group targets into parent updates
                    const updates = targets.reduce((updates, target) => {
                        const parentTarget = target.slice(0,-1); 
                        const key = target.slice(-1)[0];                       
                        const parentRef = parentTarget.reduce((ref, key) => ref.child(key), ref);
                        const parentUpdate = updates.find(update => update.ref.path === parentRef.path);
                        const cacheValue = target.reduce((value, key) => value[key], cache);
                        if (parentUpdate) {
                            parentUpdate.value[key] = cacheValue;
                        }
                        else {
                            updates.push({ ref: parentRef, value: { [key]: cacheValue }});
                        }
                        return updates;
                    }, [] as { ref: DataReference, value: any }[]);

                    console.log(`Processing ${updates.length} db updates`);
                    
                    processQueueTimeout = null;
                    processPromise = updates.reduce(async (promise:Promise<any>, update) => {
                        await promise;
                        return update.ref.update(update.value)
                        .catch(err => {
                            onErrorCallback({ source: 'update', message: `Error processing update of "/${ref.path}"`, details: err });
                        });
                    }, processPromise);
                });
            }
        };

        const snap = await ref.get();
        loaded = true;
        cache = snap.val();
    
        const proxy = createProxy({ root: { ref, cache }, target: [], id: proxyId, flag: flagOverwritten });
        return { 
            destroy() {
                subscription.stop();
            },
            value: proxy,
            onMutation(callback: ProxyObserveMutationsCallback) {
                // Fires callback each time anything changes
                onMutationCallback = (...args) => {
                    try { callback(...args); }
                    catch(err) { 
                        onErrorCallback({ source: 'mutation_callback', message: 'Error in dataproxy onMutation callback', details: err });
                    }
                };
            },
            onError(callback: ProxyObserveErrorCallback) {
                // Fires callback each time anything goes wrong
                onErrorCallback = (...args) => {
                    try { callback(...args); }
                    catch(err) { console.error(`Error in dataproxy onError callback: ${err.message}`); }
                }
            }
        }
    }
}

type ProxyObserveMutationsCallback = (mutationSnapshot: DataSnapshot, isRemoteChange: boolean) => any
type ProxyObserveErrorCallback = (error: { source: string, message: string, details: Error }) => any

function getTargetValue(obj: any, target: Array<number|string>) {
    let val = obj;
    for (let key of target) { val = typeof val === 'object' && val !== null && key in val ? val[key] : null; }
    return val;
}
function getTargetRef(ref: DataReference, target: Array<number|string>) {
    let targetRef = ref;
    for (let key of target) { targetRef = targetRef.child(key); }
    return targetRef;
}

//update(ref: DataReference, value: any): void
function createProxy(context: { root: { ref: DataReference, cache: any }, target: Array<number|string>, id: string, flag(target: Array<number|string>): void }) {
    let targetRef = getTargetRef(context.root.ref, context.target);
    targetRef.context({ proxy_id: context.id });

    const handler:ProxyHandler<any> = {
        get(target, prop, receiver) {
            if (typeof prop === 'symbol') { throw new Error(`Symbols are not allowed as proxy properties`); }
            target = getTargetValue(context.root.cache, context.target);

            if (typeof target === null || typeof target === 'undefined') {
                throw new Error(`Cannot read ${prop} of ${context.target.join('/')} because the underlying data is unavailable`);
            }

            // If the property contains a simple value, return it. 
            const value = target[prop];
            if (['string','number','boolean'].includes(typeof value) 
                || value instanceof Date 
                || value instanceof PathReference 
                || value instanceof ArrayBuffer 
                || (typeof value === 'object' && 'buffer' in value)
            ) {
                return value;
            }

            const isArray = target instanceof Array;
            if (isArray && typeof value === 'function') {
                const writeArray = ret => {
                    context.flag(context.target);
                    return ret;
                }
                if (prop === 'push') {
                    return function push(...items) {
                        const ret = target.push(...items); // push the items to the cache array
                        return writeArray(ret);
                    }
                }
                else if (prop === 'pop') {
                    return function pop() {
                        const ret = target.pop();
                        return writeArray(ret);
                    }
                }
                else if (prop === 'splice') {
                    return function splice(start: number, deleteCount?: number, ...items) {
                        const ret = target.splice(start, deleteCount, ...items);
                        return writeArray(ret);
                    }
                }
                else if (prop === 'shift') {
                    return function shift() {
                        const ret = target.shift();
                        return writeArray(ret);
                    }
                }
                else if (prop === 'unshift') {
                    return function unshift(...items) {
                        const ret = target.unshift(...items);
                        return writeArray(ret);
                    }
                }
                else if (prop === 'sort') {
                    return function sort(compareFn?: (a, b) => number) {
                        const ret = target.sort(compareFn);
                        return writeArray(ret);
                    }
                }
                else if (prop === 'reverse') {
                    return function reverse() {
                        const ret = target.reverse();
                        return writeArray(ret);
                    }
                }
                else {
                    // Other array function, does not alter its value
                    return function fn(...args) {
                        return target[prop](...args);
                    }
                }
            }
            else if (!isArray && prop === 'push') {
                // Push item to an object collection

                return function push(item: any) {
                    const childRef = targetRef.push();
                    // Add item to cache collection
                    target[childRef.key] = item;
                    // // Add it to the database, return promise
                    // return childRef.set(item);
                    context.flag(context.target.concat(childRef.key)); //(childRef, item);
                }
            }
            else if (!(prop in target)) {
                return undefined;
            }

            // Proxify any other value
            return createProxy({ root: context.root, target: context.target.concat(prop), id: context.id, flag: context.flag });
        },

        set(target, prop, value, receiver) {
            // Eg: chats.chat1.title = 'New chat title';
            // target === chats.chat1, prop === 'title'
            if (typeof prop === 'symbol') { throw new Error(`Symbols are not allowed as proxy properties`); }
            target = getTargetValue(context.root.cache, context.target); // let parentValue = createTarget(args.root.cache, args.target, prop);
            
            if (target === null || typeof target === 'undefined') {
                throw new Error(`Cannot set property "${prop}" because the value of path "/${targetRef.path}" is ${target}`);
            }
            if (target instanceof Array && (typeof prop !== 'number' && !/^[0-9]+$/.test(prop))) {
                throw new Error(`Cannot set property "${prop}" on array value of path "/${targetRef.path}"`);
            }

            // Set cached value:
            // let success = Reflect.set(target, prop, value, receiver);
            target[prop] = value;

            if (target instanceof Array) {
                // Flag the entire array to be overwritten
                context.flag(context.target); //(targetRef, target);
            }
            else {
                // Flag child property
                context.flag(context.target.concat(prop)); //(targetRef.child(prop), value);
            }

            return true;
        },

        ownKeys(target) {
            target = getTargetValue(context.root.cache, context.target);
            return Reflect.ownKeys(target);
        },

        has(target, prop) {
            target = getTargetValue(context.root.cache, context.target);
            return Reflect.has(target, prop);
        }
    };
    return new Proxy({}, handler) as any;
}