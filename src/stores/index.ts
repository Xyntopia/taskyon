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
  //pinia.use(piniaPluginPersistedstate)
  pinia.use(({ store }) => {
    //console.log(`load ${store.$id} state!`);

    //const storedState = LocalStorage.getItem(store.$id) as string;
    //const oldState = JSON.parse(storedState) as typeof store.$state;
    //store.$state = deepMerge(store.$state, oldState);
    // this works, because only refs appear in the state here. Everything else
    // e.g. if we define classes isn't subject to this :P
    store.$subscribe(() => {
      LocalStorage.set(store.$id, JSON.stringify(store.$state));
    });
  });

  return pinia;
});
