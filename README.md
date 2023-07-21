↗️Vexvault↗️: 🌐 Browser Based, 🤖 AI Native, 🆓 0-Cost, 🔒 privacy-first, 💼 Document Store
==========================================================================================


***


## Introduction:

Vexvault is a user-friendly, browser-based document storage system that allows you to securely store and access large amounts of data, including documents in various formats like pdf, txt, md, and docx. It's designed to keep your data local to your computer, providing a secure vault that's accessible to you and, with your explicit permission, to other webpages and AI tools like ChatGPT.

What sets Vexvault apart is its simplicity and privacy. There's no need for installation or registration, as all data resides solely on your computer. This unique feature not only ensures easy compliance with data protection regulations but also keeps your data secure.

Best of all, Vexvault is completely free to use.

For those looking to integrate Vexvault into their website or app, it's as simple as using an iframe from www.vexvault.com. This allows the same data to be available across multiple webpages, providing a secure and persistent storage solution.

## History

Vexvault started its life during a hackathon SDx in 2023 as a proof-of-concept by Xyntopia.

## Use Cases:

1. **ChatGPT Context**: Vexvault can be used to give ChatGPT and other LLMs context by creating context from chat prompts.
2. **Document Storage**: It can be used as a central storage for documents, accessible from multiple webpages.
3. **Data Sharing**: It can be used to share data securely with third-party webpages, with permission.
4. **Data Analysis**: With its vector ANN search, it can be used for data analysis tasks.
5. **Integration with Apps**: It can be integrated with different apps via iframe for data access and manipulation.


### How to use?

- [Iframe Tutorial](tutorial_vexvault_iframe.md)
- [Example Page](public/widget_examples/search_w_upload.html)
- [Use in your own project](DEVELOPMENT.md)

### How does it Work?

TODO: add some graphics for better illustration of features

Vexvault is a browser-based vector & document store that uses indexeddb as a backend and webassembly + hnswlib for vector Approximate Nearest Neighbor (ANN) search. It's designed to be accessible, scalable, and secure, making it an ideal solution for storing and accessing large amounts of data.

🔒↗️🤖🔒↗️🔒↗️🤖

Vexvault automatically creates embeddings client-side and locally, ensuring data privacy and reducing the need for data transfer. It's designed to be accessible from anywhere for language learning models like ChatGPT and other tools, making it a versatile solution for a range of applications.

📚🌐📚🌐📚🌐📚🌐

The data stored in Vexvault is persisted in indexeddb for the URL it is deployed on and can be accessed through an iframe, making it possible to use the same information storage for multiple webpages. When using the Vexvault as it is deployed under the URL [](http://www.vexvault.com), this becomes particularly useful for applications that need to share data across different webpages or platforms. 

🛠️🔍🛠️🔍🛠️🔍🛠️🔍 

Vexvault comes with an admin interface for easy management and is open source, allowing for personal deployment. It also supports document upload in various formats, with more formats to come.

🛡️💼🔒🛡️💼🔒🛡️💼 

In terms of data protection, Vexvault stores data client-side in the browser, ensuring easy compliance with data protection regulations. It also has a feature in progress for synchronization with gdrive/dropbox/onedrive, further enhancing its data management capabilities.

🗝️☁️🛠️🗝️💽🛠️🗝️💽

Vexvault is accessible to all kinds of different apps via iframe, making it a versatile solution for a range of applications. It's also scalable, capable of storing large amounts of data, typically up to 80% of available disk space.

🌐📂🌐📂🌐📂🌐📂

The standard URL for Vexvault is www.vexvault.com, which can be used to store information. This makes it easy to integrate Vexvault into your applications or webpages. Furthermore, no registration is required to use Vexvault, and it works out of the box, making it a convenient and user-friendly solution for data storage and access.

In summary, Vexvault is a powerful, flexible, and secure solution for browser-based data storage. Its combination of advanced features and ease of use make it an excellent choice for a wide range of applications, from giving context to language learning models like ChatGPT, to serving as a central storage for documents.

## Features of Vexvault:

1. **Accessibility**: Vexvault is accessible from language learning models like ChatGPT and other tools.
2. **Security**: It is safe and not accessible until permission is granted for 3rd party webpages.
3. **Admin Interface**: Vexvault comes with an admin interface for easy management.
4. **Open Source**: The code is open source and available for personal deployment.
5. **Persistent Storage**: If deployed under "www.vexvault.com", the same information storage can be used for multiple webpages. The information will persist in indexeddb for the given URL and can be accessed through the iframe.
6. **Backend Technology**: It uses indexeddb as a backend and webassembly + hnswlib for vector ANN search.
7. **Client-side Embeddings**: Vexvault automatically creates embeddings client-side and locally.
8. **No Registration Required**: It requires no registration to use.
9. **Data Compliance**: Easy compliance due to data stored client-side, in the browser.
10. **Scalability**: Vexvault is scalable to accommodate growing data needs.
11. **No Installation**: It works out of the box, requiring no installation.
12. **Large Data Storage**: It can store large amounts of data, typically up to 80% of available disk space.
13. **Document Upload**: Vexvault supports document upload in various formats including pdf, txt, md, docx, with more to come.
14. **Data Protection**: It ensures your data is protected.
15. **Cost**: Vexvault is free to use.
16. **Central Storage**: It serves as a central storage for your documents.
17. **App Accessibility**: It is accessible to all kinds of different apps via iframe.
18. **Sync in Progress**: Synchronization with gdrive/dropbox/onedrive is in progress.
19. **Standard URL**: The "standard" url is: www.vexvault.com, which can be used to store information.

## Roadmap:

- Sync across devices using gdrive/dropbox/onedrive etc...
- Include more performant backends such as cozodb (doesn't support persistent storage in browser as of July/2023)
- Add widgets for direct inclusion svelte/react/angular/vue instead of iframe. The UI is written in Vue3/Quasar/webassembly, but is not (yet) available as an npm package.
