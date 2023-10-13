//import { PDFLoader } from "langchain/document_loaders/fs/pdf";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as pdfjsLibRaw from 'pdfjs-dist/webpack';
import * as mammoth from 'mammoth';
import type pdfjsLibModule from 'pdfjs-dist';
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
  console.log('load file: ' + file.type);
  switch (file.type) {
    case 'application/pdf':
      return await read_pdf(file);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return await read_docx(file);
    default:
      if (file.type.startsWith('text')) {
        return file.text();
      } else {
        console.log(`unknown file type: ${file.type} from ${file.name}`);
        return undefined;
      }
  }
}