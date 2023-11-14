import { loadTokenizer, loadModel } from './mlModels';
import {
  PreTrainedModel,
  PreTrainedTokenizer,
  AutoModel,
  AutoTokenizer,
  Tensor,
  mean_pooling,
} from '@xenova/transformers';

const modelName = 'Xenova/all-MiniLM-L6-v2';

async function keywords(text: string) {
  // first calculate all vectors for all tokens
  const modelName = 'Xenova/all-MiniLM-L6-v2';
  const { res, inputs } = await token_vectorize(text, modelName);

  const tokenizer = await loadTokenizer();
  const tokenVectors = res.last_hidden_state[0] as Tensor;
  // is a tensor of the last hidden state
  // tensors can be accessed simply by doing tokenVectors[numToken] and each of them are

  // the tokenized text:
  const textTokens = (tokenVectors.data as number[]).map(
    (x) => tokenizer.model.vocab[x]
  );
}

export async function token_vectorize(txt: string, modelName: string) {
  console.log('calculate vectors');
  const tokenizer = await loadTokenizer(modelName);
  const model = await loadModel(modelName);
  const inputs = (await tokenizer(txt, { return_tensor: false })) as Record<
    string,
    Tensor
  >;
  const res = (await model(inputs)) as Record<string, Tensor>;
  return { res, inputs };
}

export async function vectorize(txt: string, modelName: string) {
  const { res, inputs } = await token_vectorize(txt, modelName);
  const res2 = mean_pooling(res.last_hidden_state, inputs.attention_mask);
  return res2;
}

/*async function summarize(txt: string, modelName: string) {
  console.log('summarize');
  const tokenizer = await loadTokenizer(modelName);
  const model = await loadModel(modelName);
  const inputs = (await tokenizer(txt)) as Record<string, Tensor>;
  //const res = (await model.generate(inputs))// as Record<string, Tensor>;
}*/
