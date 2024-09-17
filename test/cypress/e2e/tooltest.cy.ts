// Use `cy.dataCy` custom command for more robust tests
// See https://docs.cypress.io/guides/references/best-practices.html#Selecting-Elements

// ** This file is an example of how to write Cypress tests, you can safely delete it **

// This test will pass when run against a clean Quasar project
describe('Tool Tests', () => {
  beforeEach(() => {
    cy.visit('/');

    // Clear local storage
    cy.clearLocalStorage();

    // Clear cookies
    cy.clearCookies();

    // Optionally, you can clear indexedDB if your app uses it
    // somehow we're getting a lot of errors here...
    /*cy.window().then((win) => {
      void win.indexedDB.databases().then((databases) => {
        databases.forEach((db) => {
          win.indexedDB.deleteDatabase(db.name!);
        });
      });
    });*/
  });
  it('Should be able to create a tool and use it, also clean up after', () => {
    // cy.contains('your message').type('hello world!{enter}');
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
    cy.get('.q-btn').contains('Use free Taskyon').click();

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
      'make sure, when creating a new chat & message, the function tag is gone...',
    );

    cy.get('[aria-label="start new chat"]').click();
    cy.contains('your message').type('hello world!{enter}');

    cy.get('.message-container')
      .eq(0)
      .get('[aria-label="show message context"]')
      .click();

    cy.wait(2000)
      .get('.message-container')
      .eq(0)
      .get('.q-field .q-chip')
      .should('not.exist');
  });
});
