/**
 * checout these forum posts:  
 * 
 * https://discuss.ipfs.tech/t/using-kubo-as-middleman-for-browser-helia-nodes/17138/2
 * https://discuss.ipfs.tech/t/ipfs-in-browser-use-case/17079
 * https://discuss.ipfs.tech/t/how-to-retrieve-content-uploaded-via-helia-using-the-ipfs-gateway/16582/5
 * 
 * TODO: persist our peer ID in localstorge or something like that. If we use memroy storage, the
 * peer ID will get regenerated on every reload of the page. 
 */

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
