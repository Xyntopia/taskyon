# ↗️ Vexvault ↗️:

- 🌐 Browser Based
- 🤖 AI Native
- 🆓 0-Cost
- 🔒 privacy-first
- 💼 Document Store

---

## Introduction:

Vexvault is a user-friendly, browser-based document storage system which makes your files & data available to AI like ChatGPT and other applications. It allows you to securely store and access large amounts of data, including documents in various formats like pdf, txt, markdown, and docx. It's designed to keep your data local to your computer, providing a secure vault that's accessible to you and, with your explicit permission, to other webpages and AI tools like ChatGPT.

What sets Vexvault apart is its simplicity and privacy. There's no need for installation or registration, all that's required for the user is to enter your webpage! And as all data resides solely on your computer it not only ensures easy compliance with data protection regulations but also keeps your data secure.

Best of all, Vexvault is completely free to use.

For those looking to integrate Vexvault into their website or app, it's as simple as using an iframe from www.vexvault.com. This allows the same data to be available across multiple webpages, providing a secure and persistent storage solution.

TODO: add screenshots of the app & integration

## History

Vexvault started its life during a hackathon SDx in 2023 as a proof-of-concept by Xyntopia.

## Use Cases:

1. **ChatGPT Context**: Vexvault can be used to give ChatGPT and other LLMs context by creating context for chat prompts.
2. **Document Storage**: It can be used as a central storage for document data, accessible from multiple webpages.
3. **Data Sharing**: It can be used to share data securely with third-party webpages, with explicit permission by the user.
4. **Data Analysis**: With its vector ANN search, it can be used for data analysis tasks.
5. **Integration with 3rd party Apps**: It can be integrated with different apps via iframe for data access.

### How to use?

- [Integrate as an iframe Tutorial](tutorial_vexvault_iframe.md)
- [Example Page with iFrame integration](public/widget_examples/search_w_upload.html)
- [Deploy your own version of Vexvault](DEVELOPMENT.md)
- [TODO: integrate in your project as a reactiv component/npm package]

### How does it Work?

TODO: add some graphics for better illustration of features

Vexvault is a browser-based vector & document store that uses indexeddb as a backend and webassembly + hnswlib for vector Approximate Nearest Neighbor (ANN) search. It's designed to be accessible, scalable, and secure, making it an ideal solution for storing and accessing large amounts of user data.

#### Embeddings and AI

🔒↗️🤖🔒↗️🔒↗️🤖

Vexvault automatically creates embeddings client-side and locally in the browser, ensuring data privacy and reducing the need for data transfer. It's designed to be accessible from anywhere for language learning models like ChatGPT and other tools, making it a versatile solution for a range of applications.

#### Data Persistence and Sharing

📚🌐📚🌐📚🌐📚🌐

The data stored in Vexvault is persisted in indexeddb. This means inside the browser the data "lives" at the URL where vexvault was deployed.
As Vexvault is open source, it is possible to deploy your personal version of vexvault with the code from this repository under a custom domain.

However, to really make use of vexvault and to be able to share document data across multiple pages or platforms (e.g. use chatbots like ChatGPT and Google Bard for plugins etc... ), it is recommended to use the domain which is provided by us (Xyntopia LLC) on [](http://www.vexvault.com). It is simply the same code but deployed under a unique URL. If you want to integrate vexvault in your app, it wil be able to share data across multiple different webapps, when using the [Vexvault URL](http://www.vexvault.com). This also prevents data duplication and is faster to integrate in your webpage.

Features of Vexvault which make data sharing across mutiple webpages easy & safe:

- Only allow access if explicitly granted by the user through a button. The webpage will be added to a whitelist which allows access to the document store.
- communicate with 3rd party apps through postMessage & iframe
- Ability to have multiple _collections_ of document stores in order to separate information

#### Database administration

🛠️🔍🛠️🔍🛠️🔍🛠️🔍

Vexvault comes with a basic admin interface for easy management you can configure the webpages which are alowed access to your data and configure various aspects of the vector store.

#### Privacy

🛡️💼🔒🛡️💼🔒🛡️💼

In terms of data protection, Vexvault stores data client-side in the browser, ensuring easy compliance with data protection regulations. It also has a feature in progress for synchronization with gdrive/dropbox/onedrive, further enhancing its data management capabilities.

In order for a 3rd party application to access the data, the user needs to grant explicit access using a button. This only has to be done once. Afterwards, the domain of the 3rd party application gets added to a whitelist which is allowed to access the data.

#### Integration

🗝️☁️🛠️🗝️💽🛠️🗝️💽

Vexvault is accessible to all kinds of different apps via iframe, making it a versatile solution for a range of applications. It's also scalable, capable of storing large amounts of data, typically up to 80% of available disk space.

🌐📂🌐📂🌐📂🌐📂

The standard URL for Vexvault is www.vexvault.com, which can be used to store information. This makes it easy to integrate Vexvault into your applications or webpages. Furthermore, no registration is required to use Vexvault, and it works out of the box, making it a convenient and user-friendly solution for data storage and access.

## Features of Vexvault:

1. **Accessibility**: Vexvault is accessible from language learning models like ChatGPT and other tools & apps.
2. **Security**: It is safe, stores data locally and not accessible until permission is granted to 3rd party webpages.
3. **Admin Interface**: Vexvault comes with an admin interface for easy management of the store.
4. **Open Source**: The code is open source and available for personal deployment.
5. **Persistent Storage**: If using the version under the domain "www.vexvault.com", the same information storage can be used for multiple webpages. The information will persist in indexeddb for this URL and can be accessed from other domains through the iframe.
6. **Fast Query Times**: It uses indexeddb as a backend and webassembly + hnswlib for vector ANN search. It doesn't need to do any roundtrips through a network and because of this, queries are very fast.
7. **Client-side Embeddings**: Vexvault automatically creates embeddings client-side and locally, ensuring data safety and 0 costs for vector lookups.
8. **No Registration Required**: It doesn't require any registration to use.
9. **Data Compliance**: Easy compliance due to data stored client-side, in the browser.
10. **Scalability**: Vexvault easily scales with the number of users for your webpage as all calculations & storage are done client-side.
11. **No Installation**: It works out of the box, requiring no installation. All that is required is to open your webpage!!
12. **Large Data Storage**: It can store large amounts of data, typically up to 80% of available disk space on the client-side.
13. **Document Upload**: Vexvault supports document upload in various formats including pdf, txt, md, docx, with more to come.
14. **Data Protection**: It ensures your data is protected.
15. **Cost**: Vexvault is free to use.
16. **Central Storage**: It serves as a central storage for your document data.
17. **Standardized URL**: The "standard" url is: www.vexvault.com, which can be used to store information.

## Roadmap:

- Sync across devices using gdrive/dropbox/onedrive etc...
- Include more performant backends such as cozodb (doesn't support persistent storage in browser as of July/2023)
- Add widgets for direct inclusion svelte/react/angular/vue instead of iframe. The UI is written in Vue3/Quasar/webassembly, but is not (yet) available as an npm package.
