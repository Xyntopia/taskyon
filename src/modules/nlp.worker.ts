import { getVector, extractKeywords } from './nlp';

self.onmessage = async ({
  data,
}: {
  data: {
    action: string;
    txt: string;
    modelName: string;
    numKeywords?: number;
  };
}) => {
  const { action, txt, modelName, numKeywords } = data;

  try {
    if (action === 'getVector') {
      const vector = await getVector(txt, modelName);
      self.postMessage({ vector });
    } else if (action === 'extractKeywords') {
      const keywords = await extractKeywords(txt, modelName, numKeywords);
      self.postMessage({ keywords });
    }
  } catch (error) {
    // Handle any errors here
    self.postMessage({ error: (error as Error).message });
  }
};
