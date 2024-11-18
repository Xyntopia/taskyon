import { createHelia } from 'helia';
import { strings } from '@helia/strings';

const getHeliaInstance = (() => {
  let heliaPromise: ReturnType<typeof createHelia>;

  return async () => {
    if (!heliaPromise) {
      heliaPromise = createHelia();
    }
    return heliaPromise;
  };
})();   

export async function exportToIpfs(txt: string) {
  const node = await getHeliaInstance();
  const s = strings(node);

  const myImmutableAddress = await s.add(txt);

  console.log(await s.get(myImmutableAddress));

  return myImmutableAddress;
}
// hello world
