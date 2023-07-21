browser-based vector store. makes vector stores for giving  generative AI/LLMs and chatbots context, accessible to everyone!

- accessible from llms such as ChatGPT and other tools.
- safe, not accessible until permission granted for 3rd party webpages.
- admin interface
- open source code available for own deployment
- if the deployment under "www.vexvault.com" is used, the same information storage can be used for multiple webpages. The information will persist in indexeddb for the given URL and can be accessed through the iframe.
- uses indexeddb as a backend and webassembly + hnswlib for vector ANN search
- automatically creates embeddings client-side and locally
- no registration required.
- easy compliance due to data stored client-side, in browser
- scalable
- no installation, works out of the box.
- large amounts of data (essentially unlimited. chrome & firefox typicall 80% of avaiable disk space)
- document upload (pdf/txt/md/docx are already supported, and more to come)
- protects your data
- 0 costs.
- central storage for your documents
- accessible to all kinds of different apps via iframe!
- in progress:   synchronization with gdrive/dropbox/onedrive
- "standard" url is:   www.vexvault.com, can be used to store information  

Browser-based vector store. Easiest possible, vectorstore!
- no registration,  installation, fast (HNSWlib webassembly)
- large amounts of data (available disk space)
- document upload

## TASK:
given the points above, write a documentation for the vectorstore called "Vexvault".

split the documentation in:
- a short summary for non-experts and non-coders (also mentioning the possibility of easy integration via iframe from www.vexvault.com)
- a longer section with more details, and explanations which is more meant to be understood by experts

### subtask:
- Before writing the documentation, infer several cool features of this database from the given bulletpoints Write this down as a list forst, before writing the documentation
- Before starting the documentation come up with some use-cases (include giving ChatGPT LLM context by creating context from chatprompts)
- Be concise, but include all points mentioned above, can be shortened if somthing is duplicate information. Don't leave out details.