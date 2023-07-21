# Tutorial: Embedding Vexvault Store in an Iframe in your Page and Communicating With It

This tutorial will guide you on how to include a vexvault Iframe within your webpage and communicate with it to perform a search operation on a vectorstore database that resides within the iframe.

## Prerequisites

- Basic understanding of HTML, CSS and JavaScript.
- A website where you want to embed the search engine. It can also be only a part of a webapge such a Content Management System which
  can render an iframe (for example some markdown engines can do that). E.g. Wordpress should work in most cases.
- A URL where the search engine with vectorstore database is hosted (Let's use the standard `http://www.vexvault.com` for the purpose of this tutorial, but it is also possible to sef-host).

## Step 1: Embedding the Iframe

First, we need to embed the iframe into the parent webpage. The `iframe` HTML tag is used for this purpose. We'll also set a specific width and height, and remove the border for aesthetic purposes.
  
Insert the following HTML code where you want the search engine to appear:

```html
<iframe id="vexvault" src="http://www.vexvault.com" style="border: none; width:400px; height:300px"></iframe>
```

This code creates an iframe, gives it an `id` of `'vexvault'`, and sets its `src` attribute to the URL of your search engine. The `style` attribute removes the border and sets the dimensions.

## Step 2: Adding a Search Box

Next, we'll add a text input and a button for entering and submitting search queries. Add the following HTML code above or below the iframe:

```html
<input type="text" id="search-input" placeholder="Enter search term">
<button id="search-button">Search</button>
```

## Step 3: Communicating with the Iframe

Now we'll add JavaScript code to send messages to the iframe and listen for messages from the iframe using the `postMessage` API and the `message` event.

Add the following code in a `<script>` tag at the end of your HTML body:

```html
<script>
    // Get the iframe element
    var iframe = document.getElementById('vexvault');

    // Get the search input and button
    var searchInput = document.getElementById('search-input');
    var searchButton = document.getElementById('search-button');

    // Listen for click events on the search button
    searchButton.addEventListener('click', function() {
        // Send a message to the iframe with the search query
        iframe.contentWindow.postMessage(searchInput.value, 'http://URL1.com');
    });

    // Listen for messages from the iframe
    window.addEventListener('message', function(event) {
        // Check the origin of the data!
        if (event.origin !== 'http://URL1.com') return;

        // Process the received data (search results)
        var results = JSON.stringify(event.data, null, 2);

        // Display the results
        alert(results);
    }, false);
</script>
```

This code sends a message to the iframe with the search query when the search button is clicked, and listens for messages from the iframe. When a message is received from the iframe, it checks the origin of the message, processes the received data (the search results), and displays the results as a formatted string in an alert box.

## Step 4: Handling the Message in the Iframe

In your search engine webpage (the one hosted on `http://www.vexvault.com`), you'll need to listen for messages from the parent page (the search query), execute the search on the vectorstore database, and send the results back in a message.

Here’s a high-level overview of how it can be done using Vue 3 and the setup method in a Vue component. Please adapt the code to your configuration and logic for executing the search operation:

```javascript
export default defineComponent({
    setup() {

        /* ... rest of your setup code ... */

        if (window.self !== window.top) { // window is in an iframe
            // Listen for messages from the parent page
            window.addEventListener('message', function (event) {
                var query = event.data as string;

                void performSearch(query).then(res => {
                    // Send results back to the parent page
                    event.source?.postMessage(res, { targetOrigin: event.origin });
                });
            }, false);
        }
    }
});
```

And that’s it! You’ve just embedded your search engine in an iframe and set up communication between the parent webpage and the iframe. When a user enters a query and clicks the search button, the query is sent to the iframe, the vectorstore database is searched, and the results are sent back to the parent webpage and displayed in an alert box.

An complete example webpage can be found here: [](public/widget_examples/search_w_upload.html)

And here is a js fiddle to play around with: [](https://codepen.io/xyntopia/pen/PoxagGK)