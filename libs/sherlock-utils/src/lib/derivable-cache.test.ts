import { atom, constant, Derivable, DerivableAtom, derive } from '@skunkteam/sherlock';
import { derivableCache, DerivableCache } from './derivable-cache';
import { fromPromise } from './from-promise';
import { template } from './template';

describe('sherlock-utils/derivableCache', () => {
    it('should support constants as output of the derivable factory', () => {
        const derivableFactory = jest.fn((nr: number) => constant(nr));
        const identityCache = derivableCache(derivableFactory);
        derive(() => identityCache(1).get() + identityCache(2).get()).react(() => 0);
        expect(derivableFactory).toHaveBeenCalledTimes(2);
        identityCache(1).get();
        identityCache(2).get();
        expect(derivableFactory).toHaveBeenCalledTimes(2);
    });

    it('should support being used inside flatMap', () => {
        const derivableFactory = jest.fn((v: string) => constant(v + v));
        const repeated = derivableCache(derivableFactory);
        const input$ = atom('abc');
        const output$ = input$.flatMap(repeated);
        let output = '';
        output$.react(v => (output = v));

        expect(derivableFactory).toHaveBeenCalledTimes(1);
        expect(derivableFactory).toHaveBeenCalledWith('abc');
        expect(output).toBe('abcabc');

        input$.set('def');

        expect(derivableFactory).toHaveBeenCalledTimes(2);
        expect(derivableFactory).toHaveBeenCalledWith('def');
        expect(output).toBe('defdef');
    });

    it('should reuse proxies as much as possible', () => {
        const cache = derivableCache<string, string>(constant);
        const proxy1 = cache('abc');
        const proxy2 = cache('abc');

        // Cannot remember proxies without connection, because we don't know when to evict them.
        expect(proxy2).not.toBe(proxy1);

        proxy1.autoCache().get();

        // But when connected we can automatically reuse proxies.
        expect(cache('abc')).toBe(proxy1);
    });

    it('should keep the dependency tree clean', () => {
        const a$ = atom(0);
        const atoms = [atom('a'), atom('b'), atom('c')];
        const cache = derivableCache((key: number) => atoms[key + a$.get()]);

        const result = cache(0).autoCache();
        expect(a$.connected).toBeFalse();
        expect(atoms.map(a => a.connected)).toEqual([false, false, false]);

        result.get();
        expect(a$.connected).toBeFalse();
        expect(atoms.map(a => a.connected)).toEqual([true, false, false]);

        // Total number of observers of cached values is 1, i.e. the autoCache reactor.
        expect(cache.observerCount()).toBe(1);

        // The number of dependencies to our result is 2, i.e. the inner derivable and the injected dependency.
        expect(result.dependencyCount).toBe(2);
    });

    describe('(using the default JavaScript map implementation)', () => {
        let derivableFactory: jest.Mock;
        let resultCache: DerivableCache<string, string>;

        beforeEach(() => {
            derivableFactory = jest.fn((k: string) => constant('result from ' + k));
            resultCache = derivableCache(derivableFactory);
        });

        it('should do no special tricks when not connected', () => {
            const d1 = resultCache('key1');
            const d2 = resultCache('key1');
            d1.get();
            expect(derivableFactory).toHaveBeenCalledTimes(1);
            d1.get();
            d2.get();
            expect(derivableFactory).toHaveBeenCalledTimes(3);
            expect(derivableFactory.mock.calls[0]).toEqual(['key1']);
            expect(derivableFactory.mock.calls[1]).toEqual(['key1']);
            expect(derivableFactory.mock.calls[2]).toEqual(['key1']);

            expect(resultCache.observerCount()).toBe(0);
            expect(resultCache.connectedKeyCount()).toBe(0);
        });

        it('should error when trying to set the proxy when the source derivable is not settable', () => {
            expect(() => resultCache('foo').set('bar')).toThrowError('Cached derivable is not settable');
        });

        it('should return a settable derivable when the derivable returns settable derivables', done => {
            const mutableCache = derivableCache<string, string>(atom, { delayedEviction: true });
            const sd1$ = mutableCache('abc');
            const sd2$ = mutableCache('abc');
            sd1$.swap(s => s + '!!!');
            expect(sd2$.value).toBe('abc!!!');

            setTimeout(() => {
                // This change is lost, cause our atom doesn't write back to a more persistent store.
                sd2$.set('whatever');
                expect(sd2$.value).toBe('abc');
                done();
            }, 0);
        });

        describe('(when connected)', () => {
            let input$: DerivableAtom<string[]>;
            let output$: Derivable<string[]>;
            let stopConnection: () => void;
            beforeEach(() => {
                input$ = atom(['key1', 'key2']);
                output$ = input$.derive(keys => keys.map(k => resultCache(k).get()));
                stopConnection = output$.react(() => 0);

                expect(derivableFactory).toHaveBeenCalledTimes(2);
                derivableFactory.mockClear();
                expect(output$.value).toEqual(['result from key1', 'result from key2']);

                expect(resultCache.observerCount()).toBe(2);
                expect([...resultCache.connectedKeys()]).toEqual(['key1', 'key2']);
            });

            it('should reuse derivations by key as long as they are connected', () => {
                // These are cached, because they are used in the connected output$:
                resultCache('key1').get();
                resultCache('key2').get();
                expect(derivableFactory).not.toHaveBeenCalled();

                // This one is not cached, because it is not used anywhere:
                resultCache('key3').get();
                expect(derivableFactory).toHaveBeenCalledTimes(1);
                resultCache('key3').get();
                expect(derivableFactory).toHaveBeenCalledTimes(2);

                stopConnection();

                // Now nothing is cached, cause the connection is stopped.

                derivableFactory.mockClear();
                resultCache('key1').get();
                resultCache('key2').get();
                resultCache('key3').get();
                expect(derivableFactory).toHaveBeenCalledTimes(3);

                derivableFactory.mockClear();
                resultCache('key1').get();
                resultCache('key1').get();
                expect(derivableFactory).toHaveBeenCalledTimes(2);
            });

            it('should create derivations when needed', () => {
                input$.swap(a => a.concat('key3', 'key3', 'key2'));
                expect(derivableFactory).toHaveBeenCalledTimes(1);
                expect(derivableFactory).toHaveBeenCalledWith('key3');

                expect(resultCache.observerCount()).toBe(3);
                expect([...resultCache.connectedKeys()]).toEqual(['key1', 'key2', 'key3']);

                expect(output$.value).toEqual([
                    'result from key1',
                    'result from key2',
                    'result from key3',
                    'result from key3',
                    'result from key2',
                ]);
            });

            it('should forget derivations when no longer used', () => {
                input$.swap(a => a.slice(0, 1));
                expect(derivableFactory).not.toHaveBeenCalled();

                expect(output$.value).toEqual(['result from key1']);

                input$.swap(a => a.concat('key2'));

                expect(derivableFactory).toHaveBeenCalledTimes(1);
                expect(derivableFactory).toHaveBeenCalledWith('key2');

                expect(output$.value).toEqual(['result from key1', 'result from key2']);
            });
        });
    });

    describe('(usecase: async work e.g. HTTP calls using custom key mapping)', () => {
        interface Request {
            method: string;
            url: string;
        }
        interface Response {
            code: number;
            body: string;
        }
        let derivableFactory: jest.Mock<Derivable<Response>, [Request]>;
        let performCall: DerivableCache<Request, Response, string>;

        beforeEach(() => {
            derivableFactory = jest.fn((input: Request) =>
                fromPromise(
                    new Promise(resolve =>
                        // Do some hard work (an HTTP call for example).
                        setTimeout(() => resolve({ code: 200, body: `Result from ${input.method} to ${input.url}.` })),
                    ),
                ),
            );
            performCall = derivableCache(derivableFactory, { mapKeys: r => `${r.method} ${r.url}` });
        });

        it('should allow inline construction of derivables without recreating them everytime the derivation is recalculated', async () => {
            const counter$ = atom(0);
            const template$ = template`Counter: ${counter$}. ${performCall({ url: '/home', method: 'GET' }).pluck(
                'body',
            )}`;

            let result = 'Loading...';
            template$.react(v => (result = v));

            // Reaction will only happen once everything in the template is resolved (this can be countered by using #fallbackTo)
            expect(result).toBe('Loading...');

            // This has no effect, cause the call has not resolved yet.
            counter$.set(1);

            expect(result).toBe('Loading...');

            // Wait until the template is ready (we can do this because template$ is already connected, so no additional work is done here)
            await template$.toPromise();

            // Now we have the full result.
            expect(result).toBe('Counter: 1. Result from GET to /home.');

            // Even when we recalculate the entire template, the call is not repeated.
            counter$.set(2);
            expect(result).toBe('Counter: 2. Result from GET to /home.');

            // In the end, the call was only performed once.
            expect(derivableFactory).toHaveBeenCalledTimes(1);
        });

        it('should cache only while anyone is connected (with toPromise for example)', async () => {
            const result$ = performCall({ url: '/url', method: 'GET' });

            expect(derivableFactory).not.toHaveBeenCalled();

            const promise = result$.toPromise();

            expect(derivableFactory).toHaveBeenCalledTimes(1);

            const otherResult$ = performCall({ url: '/url', method: 'GET' }).autoCache();

            expect(otherResult$.resolved).toBe(false);

            expect(await promise).toEqual({ code: 200, body: 'Result from GET to /url.' });
            expect(otherResult$.value).toEqual({ code: 200, body: 'Result from GET to /url.' });

            expect(derivableFactory).toHaveBeenCalledTimes(1);
        });
    });

    describe('(with delayedEviction on)', () => {
        it('should keep the cached entry after disconnection until end of tick', done => {
            const derivableFactory = jest.fn((s: string) => constant(s));
            const cache = derivableCache(derivableFactory, { delayedEviction: true });

            cache('abc').get();
            cache('abc').get();
            cache('abc').get();
            expect(derivableFactory).toHaveBeenCalledTimes(1);

            setTimeout(() => {
                cache('abc').get();
                cache('abc').get();
                expect(derivableFactory).toHaveBeenCalledTimes(2);
                done();
            }, 0);
        });
    });
});
