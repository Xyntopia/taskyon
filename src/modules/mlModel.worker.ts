import { getVector } from './mlModels';

self.onmessage = async ({
  data,
}: {
  data: { txt: string; modelName: string };
}) => {
  try {
    const { txt, modelName } = data;
    const vector = await getVector(txt, modelName);
    //const vector = [42];
    self.postMessage({ vector });
  } catch (error) {
    // Handle any errors here
    self.postMessage({ error: (error as Error).message });
  }
};
