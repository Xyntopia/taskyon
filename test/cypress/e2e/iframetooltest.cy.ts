// Use `cy.dataCy` custom command for more robust tests
// See https://docs.cypress.io/guides/references/best-practices.html#Selecting-Elements

// ** This file is an example of how to write Cypress tests, you can safely delete it **

// This test will pass when run against a clean Quasar project
describe('iframe integration', () => {
  beforeEach(() => {
    cy.wrap(
      Cypress.automation('remote:debugger:protocol', {
        command: 'Network.clearBrowserCache',
      }),
    );
    cy.visit('/');

    // Clear local storage
    cy.clearLocalStorage();

    // Clear cookies
    cy.clearCookies();

    // Optionally, you can clear indexedDB if your app uses it
    // somehow we're getting a lot of errors here...
    cy.window().then(async (win) => {
      const databases = await win.indexedDB.databases();
      databases.forEach((db) => {
        win.indexedDB.deleteDatabase(db.name!);
      });
    });

    cy.reload();
  });

  const getIframeBody = () => {
    // get the iframe > document > body
    // and retry until the body element is not empty
    return (
      cy
        .get('iframe')
        .its('0.contentDocument.body')
        .should('not.be.empty')
        // wraps "body" DOM element to allow
        // chaining more Cypress commands, like ".find(...)"
        // https://on.cypress.io/wrap
        .then(cy.wrap)
    );
  };

  const getIframeWindow = () => {
    return cy.get('iframe').its('0.contentWindow').should('exist');
  };

  const clearIframeStorage = () => {
    // Clear iframe localStorage and cookies
    getIframeWindow().then((iframeWin) => {
      iframeWin.localStorage.clear();
      iframeWin.sessionStorage.clear();

      // Clear IndexedDB of the iframe
      iframeWin.indexedDB.databases().then((databases: { name?: string }[]) => {
        databases.forEach((db) => {
          iframeWin.indexedDB.deleteDatabase(db.name!);
        });
      });
    });
  };

  it(
    'Should be able to create a tool and use it through the iframe',
    { baseUrl: null },
    () => {
      cy.visit('./public/docs/examples/simpleExampleLocal.html'); //.wait(10000);

      clearIframeStorage();

      cy.reload();

      getIframeBody().should('exist');
      //getIframeBody().find('#q-app').should('exist');
      //getIframeBody().get('.q-btn').should('exist');
      getIframeBody().contains('Use free Taskyon').click();
      getIframeBody()
        .find('button[aria-label="Open Sidebar"]')
        .should('exist')
        .click();

      getIframeBody()
        .find('[aria-label="Expert mode"] > .q-toggle__inner')
        .click();
      getIframeBody()
        .find('[aria-label="Show task costs"] > .q-toggle__inner')
        .click();

      //getIframeBody().find('button[aria-label="Open Sidebar"]').click();
      getIframeBody().click();

      getIframeBody()
        .contains('your message')
        .type(
          'Can you add the two strings: "cypress" and "test function"  for me using the provided tool?  {enter}',
        );

      cy.get('#output').contains('cypresstest function');

      getIframeBody().contains('myExampleStringAdderAlone').click();
      getIframeBody()
        .contains(/^result:[\|\s]*cypresstest function/)
        .should('exist');

      cy.screenshot('iframe_integration', { overwrite: true });

      // TODO: make sure we are in minimal mode and all the other stuff required for embedded taskyon

      //cy.title().should('include', 'taskyon');

      /*cy.contains('your message').type('hello world!{enter}');
      //cy.get('li').first().click();
      //cy.contains('Clicks on todos: 1').should('exist');

      // enable task cost display & expert mode...

      //cy.get('[aria-label="Open Sidebar"]').click();
      cy.get('.q-toggle').contains('Expert mode').click();
      cy.get('.q-btn').contains('Tools').click();

      cy.get('.q-btn').contains('Tools').click();
      cy.get('.q-btn').contains('new tool').click();
      // check if codemirror editor was already loaded..
      cy.get('.cm-content').should('exist');

      cy.get('.q-btn').contains('save task').click();

      cy.get('[aria-label="go to chat"]').click();
      cy.get('.q-btn').contains('Use free Taskyon (low quality)').click();

      cy.get('.message-container')
        .eq(0)
        .get('[aria-label="show message context"]')
        .click();
      cy.wait(2000)
        .get('.message-container')
        .eq(0)
        .get('.q-field .q-chip')
        .contains('function')
        .should('exist');

      console.log(
        'make sure, when creating a new chat & message, the function tag is gone...'
      );

      startNewChat()
      cy.contains('your message').type('hello world!{enter}');

      cy.get('.message-container')
        .eq(0)
        .get('[aria-label="show message context"]')
        .click();

      cy.wait(2000)
        .get('.message-container')
        .eq(0)
        .get('.q-field .q-chip')
        .should('not.exist');*/
    },
  );
});
