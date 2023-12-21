const nlpWorker = new Worker(new URL('./nlp.worker.ts', import.meta.url));

// Function to send data to the worker and receive the result
export function vectorizeText(
  text: string,
  modelName: string
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    nlpWorker.onmessage = ({
      data,
    }: {
      data: { error?: unknown; vector?: number[] };
    }) => {
      if (data.vector) {
        resolve(data.vector);
      } else if (data.error) {
        reject(data.error);
      }
    };

    nlpWorker.onerror = (error) => {
      reject(error);
    };

    console.log('calling worker with model:', modelName);
    nlpWorker.postMessage({ txt: text, modelName: modelName });
  });
}

export function extractKeywordsFromText(
  text: string,
  modelName: string,
  numKeywords = 5
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    nlpWorker.onmessage = ({
      data,
    }: {
      data: { error?: unknown; keywords?: string[] };
    }) => {
      if (data.keywords) {
        resolve(data.keywords);
      } else if (data.error) {
        reject(data.error);
      }
    };

    nlpWorker.onerror = (error) => {
      reject(error);
    };

    console.log('calling worker for keywords with model:', modelName);
    nlpWorker.postMessage({
      action: 'extractKeywords',
      txt: text,
      modelName: modelName,
      numKeywords: numKeywords,
    });
  });
}
