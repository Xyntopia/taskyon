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
import { unixfs } from '@helia/unixfs';
import { LevelDatastore } from 'datastore-level';
import { MemoryBlockstore } from 'blockstore-core';

//const agentVersion = 'Taskyon - helia';

// search for "libp2pDefaults" frontend/node_modules/helia/src/utils/libp2p-defaults.ts
// in the helia library to get an idea about helia standard configuration...

async function createHeliaInstance() {
  const datastore = new LevelDatastore('helia-example');
  const blockstore = new MemoryBlockstore();

  // libp2p is the networking layer that underpins Helia
  // here is an overview of its configuration options:  https://github.com/libp2p/js-libp2p/blob/main/doc/CONFIGURATION.md

  //const libp2p = await createLibp2p({ ...libp2pDefaults, datastore });

  const heliaInstance = await createHelia({
    datastore,
    blockstore,
    //libp2p,
  });

  // set server mode for helia :)
  // await heliaInstance.libp2p.services.dht.setMode('server');

  console.log('Created Helia instance');
  return heliaInstance;
}

export type IpfsNode = Awaited<ReturnType<typeof createHeliaInstance>>;

export const getIpfsNode = (() => {
  let heliaInstance: IpfsNode;

  return async () => {
    if (!heliaInstance) {
      heliaInstance = await createHeliaInstance();
    }
    return heliaInstance;
  };
})();

const getConnectedPeers = async (node: IpfsNode) => {
  const peers = node.libp2p.getPeers();
  /*for (const peer of peers) {
      const peerEl = document.createElement('li');
      peerEl.innerText = peer.toString();
      connectedPeersList.appendChild(peerEl);
    }*/
  return { peer_num: peers.length };
};

function getMultiaddrs(node: IpfsNode) {
  if (!node) return { multiaddrList: undefined };

  // multiaddrList.innerHTML = "";
  // console.log(helia.libp2p.getMultiaddrs().map((ma) => ma.toString()).join(', '))
  const multiaddrList = node.libp2p.getMultiaddrs();
  // if (multiaddrs.length === 0) {
  //   return
  // }
  const actualMultiaddrStrings = multiaddrList.map((ma) => ma.toString());

  return { multiaddr: actualMultiaddrStrings };
}

export async function exportToIpfs(node: IpfsNode, txt: string) {
  const s = strings(node);

  const myImmutableAddress = await s.add(txt);
  node.routing.provide(myImmutableAddress);

  console.log('exported string to IPFS using CID:', myImmutableAddress.toString());
  //console.log(await s.get(myImmutableAddress));

  return myImmutableAddress;
}

const addFile = async (node: IpfsNode, fileContent: Uint8Array, path: string) => {
  console.log('Adding a test file to Helia...');

  const fs = unixfs(node);
  const fileToAdd = { path: path, content: fileContent };

  const cid = await fs.addFile(fileToAdd);
  console.log(`Preview: https://ipfs.io/ipfs/${cid.toString()}`);
  return cid;
};
// hello world

export const addTestFile = (node: IpfsNode) => {
  const encoder = new TextEncoder();
  const fileContent = encoder.encode(`Test file content - ${new Date().toISOString()}`);

  return addFile(node, fileContent, 'testfile.txt');
};

export const fetchNodeStatus = async (
  node: IpfsNode & {
    libp2p: {
      services: {
        dht?: { getMode: () => Promise<string> };
      };
      status: string;
    };
  },
) => {
  try {
    const metrics = node.metrics;
    const connectedPeers = await getConnectedPeers(node);

    const info: Record<string, unknown> = {
      peerId: node.libp2p.peerId.toString(),
      'node started': node ? true : false,
      ...connectedPeers,
      metrics: metrics ?? {},
      ...getMultiaddrs(node),
    };

    if (node.libp2p.services.dht?.getMode) {
      const dhtMode = await node.libp2p.services.dht.getMode();
      const statusText = `${node.libp2p.status} - ${
        dhtMode === 'client' ? 'DHT Client' : 'DHT Server'
      }`;
      info.dhtMode = statusText;
    }

    return info;
  } catch (error) {
    console.error('Error fetching node status:', error);
    if (error instanceof Error) {
      return { error: error.message };
    }
  }
};

type Tail<T extends unknown[]> = T extends [unknown, ...infer Rest] ? Rest : never;

export async function useIpfs() {
  // Example usage:
  const originalFunctions = {
    getConnectedPeers,
    getMultiaddrs,
    exportToIpfs,
    addTestFile,
    fetchNodeStatus,
  };
  type Fs = typeof originalFunctions;
  const ipfsnode = await getIpfsNode();
  const bound = Object.fromEntries(
    Object.entries(originalFunctions).map(([key, fn]) => [
      key,
      //(...args: Tail<Parameters<Fs[keyof Fs]>>) => fn(ipfsnode, ...args),
      (...args: Tail<Parameters<Fs[keyof Fs]>>) =>
        (fn as (...args: unknown[]) => unknown)(ipfsnode, ...args),
    ]),
  ) as {
    [K in keyof Fs]: (...args: Tail<Parameters<Fs[K]>>) => ReturnType<Fs[K]>;
  };
  return { node: ipfsnode, ...bound };
}
