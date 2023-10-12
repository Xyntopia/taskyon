import { watch, ref, UnwrapRef, Ref } from 'vue';

// localStorage.ts

/**
 * Loads a state from localStorage using a specified key.
 *
 * @template T - The type of the state.
 * @param {string} key - The key under which the state is stored in localStorage.
 * @returns {T | null} - The state, parsed from JSON, or null if no state was found.
 */
function loadState<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

/**
 * Saves a state to localStorage under a specified key.
 *
 * @template T - The type of the state.
 * @param {string} key - The key under which to store the state in localStorage.
 * @param {T} state - The state to store.
 */
function saveState<T>(key: string, state: T): void {
  localStorage.setItem(key, JSON.stringify(state));
}

/**
 * Makes a state reactive and automatically saves and loads it from localStorage.
 *
 * @template T - The type of the state.
 * @param {string} key - The key under which to store and retrieve the state in localStorage.
 * @param {T} initialState - The initial state, to be used if no state is currently stored in localStorage.
 * @returns {Ref<UnwrapRef<T>>} - A reactive reference to the state.
 */
export function syncStateWLocalStorage<T>(
  key: string,
  initialState: T
): Ref<UnwrapRef<T>> {
  console.log('loading state!')
  const savedState = loadState<T>(key);
  const state = ref(initialState);
  if (savedState != null) {
    const newState = {
      ...initialState,
      ...savedState,
    };
    state.value = newState as UnwrapRef<T>;
  }

  watch(
    () => state,
    (newValue) => {
      saveState(key, newValue.value);
    },
    {
      deep: true,
    }
  );

  return state;
}
