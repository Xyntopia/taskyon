import { watch } from 'vue';
import { store } from 'quasar/wrappers';
import { createPinia } from 'pinia';
import { LocalStorage } from 'quasar';

/*
 * If not building with SSR mode, you can
 * directly export the Store instantiation;
 *
 * The function below can be async too; either use
 * async/await or return a Promise which resolves
 * with the Store instance.
 */

export default store((/* { ssrContext } */) => {
  const pinia = createPinia();

  // You can add Pinia plugins here
  // pinia.use(SomePiniaPlugin)

  const storedState = LocalStorage.getItem('piniaState') as string;
  if (storedState) {
    const oldState = JSON.parse(storedState) as typeof pinia.state;

    pinia.state.value = { ...pinia.state.value, ...oldState };

    console.log('restored state!')
  }

  watch(
    pinia.state,
    (state) => {
      // persist the whole state to the local storage whenever it changes
      LocalStorage.set('piniaState', JSON.stringify(state));
    },
    { deep: true }
  );

  return pinia;
});
