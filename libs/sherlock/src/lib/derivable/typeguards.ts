import type { Derivable, DerivableAtom, SettableDerivable } from '../interfaces';
import { Atom } from './atom';
import { BaseDerivable } from './base-derivable';
import { BiMapping } from './map';

/**
 * Returns true iff the provided `derivable` is a Derivable.
 *
 * @param derivable the object to test
 */
export function isDerivable<V>(derivable: Derivable<V>): derivable is Derivable<V>;
export function isDerivable(obj: unknown): obj is Derivable<unknown>;
export function isDerivable(derivable: unknown) {
    return derivable instanceof BaseDerivable;
}

/**
 * Returns true iff the provided `derivable` is a SettableDerivable.
 *
 * @param derivable the object to test
 */
export function isSettableDerivable<V>(derivable: Derivable<V>): derivable is SettableDerivable<V>;
export function isSettableDerivable(obj: unknown): obj is SettableDerivable<unknown>;
export function isSettableDerivable(derivable: unknown) {
    return isDerivable(derivable) && derivable.settable;
}

/**
 * Returns true iff the provided `derivable` is a proper DerivableAtom. Note that atoms can become final after which they will not
 * satisfy the `DerivableAtom` interface anymore.
 *
 * @param obj the object to test
 */
export function isDerivableAtom<V>(derivable: Derivable<V>): derivable is DerivableAtom<V>;
export function isDerivableAtom(obj: unknown): obj is DerivableAtom<unknown> {
    return (obj instanceof Atom && obj.settable) || (obj instanceof BiMapping && isDerivableAtom(obj._base));
}
