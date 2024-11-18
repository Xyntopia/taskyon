import { createHelia } from 'helia';
import { strings } from '@helia/strings';

const helia = await createHelia();
const s = strings(helia);

const myImmutableAddress = await s.add('hello world');

console.log(await s.get(myImmutableAddress));
// hello world
