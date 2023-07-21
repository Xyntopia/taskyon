//import { PDFLoader } from "langchain/document_loaders/fs/pdf";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as pdfjsLibRaw from 'pdfjs-dist/webpack';
import * as mammoth from 'mammoth';
import type pdfjsLibModule from 'pdfjs-dist';
import { ref } from 'vue';
import {
  AutoModel,
  AutoTokenizer,
  mean_pooling,
  PreTrainedModel,
  PreTrainedTokenizer,
  Tensor,
} from '@xenova/transformers';
const pdfjsLib = pdfjsLibRaw as typeof pdfjsLibModule;

async function read_pdf(file: File) {
  const typedArray = await file.arrayBuffer();

  // Load the PDF file.
  //const loadingTask = PDFJS.getDocument(pdfData);
  //const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
  //const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
  const loadingTask = pdfjsLib.getDocument({ data: typedArray });
  const pdf = await loadingTask.promise;

  let textContent = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    // Fetch the page
    const page = await pdf.getPage(i);

    // Fetch the text content
    const text = await page.getTextContent();

    // Concatenate the text
    textContent += text.items
      .map((item) => ('str' in item ? item.str : ''))
      .join('\n');
  }

  return textContent;
}

async function read_docx(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
  return result.value;
}

export async function loadFile(file: File) {
  switch (file.type) {
    case 'application/pdf':
      return await read_pdf(file);
    case 'text/markdown':
    case 'text/plain':
      return file.text();
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return await read_docx(file);
    default:
      console.log(`unknown file type: ${file.type} from ${file.name}`);
  }
}

export const useVectorizer = () => {
  const state = ref({
    vectorizerModel: undefined as PreTrainedModel | undefined,
    vectorizerTokenizer: undefined as PreTrainedTokenizer | undefined,
  });

  async function loadModel(modelName: string) {
    if (state.value.vectorizerModel == undefined) {
      console.log(`load model: ${modelName}`);
      state.value.vectorizerModel = await AutoModel.from_pretrained(modelName);
      return state.value.vectorizerModel;
    } else {
      return state.value.vectorizerModel;
    }
  }

  async function loadTokenizer(modelName: string) {
    if (state.value.vectorizerTokenizer == undefined) {
      console.log(`load tokenizer: ${modelName}`);
      state.value.vectorizerTokenizer = await AutoTokenizer.from_pretrained(
        modelName
      );
      return state.value.vectorizerTokenizer;
    } else {
      return state.value.vectorizerTokenizer;
    }
  }

  async function vectorize(txt: string, modelName: string) {
    //let classifier = await pipeline('sentiment-analysis');

    console.log('calcuate vectors');
    const tokenizer = await loadTokenizer(modelName);
    const model = await loadModel(modelName);
    const inputs = (await tokenizer(txt)) as Record<string, Tensor>;
    const res = (await model(inputs)) as Record<string, Tensor>;
    const res2 = mean_pooling(res.last_hidden_state, inputs.attention_mask);
    return res2;
  }
  return {
    vectorize,
  };
};
