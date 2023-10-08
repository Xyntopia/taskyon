import { watch, ref, UnwrapRef, Ref } from 'vue';

// localStorage.ts
function loadState<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

function saveState<T>(key: string, state: T): void {
  localStorage.setItem(key, JSON.stringify(state));
}

// make a state reactive and automatically save & load it from localstorage
export function syncStateWLocalStorage<T>(
  key: string,
  initialState: T
): Ref<UnwrapRef<T>> {
  console.log('load!!!')
  const savedState = loadState<T>(key);
  const state = ref(initialState);
  if (savedState != null) {
    state.value = savedState as UnwrapRef<T>;
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
