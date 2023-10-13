import {
  PreTrainedModel,
  PreTrainedTokenizer,
  AutoModel,
  AutoTokenizer,
  Tensor,
  mean_pooling,
} from '@xenova/transformers';
import { ref } from 'vue';

const state = ref({
  models: {} as Record<string, PreTrainedModel>,
  tokenizers: {} as Record<string, PreTrainedTokenizer>,
});

async function loadModel(modelName: string) {
  if (!state.value.models[modelName]) {
    console.log(`load model: ${modelName}`);
    state.value.models[modelName] = await AutoModel.from_pretrained(modelName);
  }
  return state.value.models[modelName];
}

async function loadTokenizer(modelName: string) {
  if (!state.value.tokenizers[modelName]) {
    console.log(`load tokenizer: ${modelName}`);
    state.value.tokenizers[modelName] = await AutoTokenizer.from_pretrained(
      modelName
    );
  }
  return state.value.tokenizers[modelName];
}

async function vectorize(txt: string, modelName: string) {
  console.log('calculate vectors');
  const tokenizer = await loadTokenizer(modelName);
  const model = await loadModel(modelName);
  const inputs = (await tokenizer(txt)) as Record<string, Tensor>;
  const res = (await model(inputs)) as Record<string, Tensor>;
  const res2 = mean_pooling(res.last_hidden_state, inputs.attention_mask);
  return res2;
}

async function summarize(txt: string, modelName:string) {
    console.log('summarize')
    const tokenizer = await loadTokenizer(modelName);
    const model = await loadModel(modelName);
    const inputs = (await tokenizer(txt)) as Record<string, Tensor>;
  
}

export const useCachedModels = () => {
  return {
    vectorize,
  };
};
