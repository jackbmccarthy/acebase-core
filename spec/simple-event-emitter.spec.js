const { SimpleEventEmitter } = require('../dist/cjs/simple-event-emitter');

describe('Simple Event Emitter', () => {
    it('once', async () => {
        // Test 'once' event emitted by `emit`
        const emitter = new SimpleEventEmitter();

        const result = {
            promise1: null,
            callback1: null,
            promise2: null,
            callback2: null,
        };

        // Test callback
        emitter.once('test', (val) => {
            result.callback1 = val;
        });

        // Test promise
        const p1 = emitter.once('test').then(val => {
            result.promise1 = val;
        });

        // Test both
        const p2 = emitter.once('test', (val) => {
            result.callback2 = val;
        }).then((val) => {
            result.promise2 = val;
        });

        // Emit success
        emitter.emit('test', 'success');

        await Promise.all([p1, p2]);

        expect(result.promise1).toBe('success');
        expect(result.promise2).toBe('success');
        expect(result.callback1).toBe('success');
        expect(result.callback2).toBe('success');
    });
    it('emitOnce', async () => {
        // Test 'once' event emitted by `emitOnce`
        const emitter = new SimpleEventEmitter();

        // Emit success once, so subscribers get this result immediately
        emitter.emitOnce('test', 'success');

        const result = {
            promise1: null,
            callback1: null,
            promise2: null,
            callback2: null,
        };

        // Test callback
        emitter.once('test', (val) => {
            result.callback1 = val;
        });

        // Test promise
        const p1 = emitter.once('test').then(val => {
            result.promise1 = val;
        });

        // Test both
        const p2 = emitter.once('test', (val) => {
            result.callback2 = val;
        }).then((val) => {
            result.promise2 = val;
        });

        await Promise.all([p1, p2]);

        expect(result.promise1).toBe('success');
        expect(result.promise2).toBe('success');
        expect(result.callback1).toBe('success');
        expect(result.callback2).toBe('success');

        // Try emitting again, should not be allowed
        try {
            emitter.emitOnce('test', 'again');
            fail('emitOnce should only be allowed to be called once per event');
        }
        catch (err) {
            // Error is expected
            // callbacks should not have fired again
            expect(result.promise1).toBe('success');
            expect(result.promise2).toBe('success');
            expect(result.callback1).toBe('success');
            expect(result.callback2).toBe('success');
        }

        try {
            emitter.emit('test', 'again');
            fail('emit should not be allowed on a previous event emitted by emitOnce');
        }
        catch (err) {
            // Error is expected
            // callbacks should not have fired again
            expect(result.promise1).toBe('success');
            expect(result.promise2).toBe('success');
            expect(result.callback1).toBe('success');
            expect(result.callback2).toBe('success');
        }
    });
});
