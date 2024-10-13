// Use `cy.dataCy` custom command for more robust tests
// See https://docs.cypress.io/guides/references/best-practices.html#Selecting-Elements

import {
  checkLastMessage,
  selectllmmodel,
  startNewChat,
  writeMessage,
} from '../support/groups';

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
    cy.window().then(async (win) => {
      const databases = await win.indexedDB.databases();
      databases.forEach((db) => {
        win.indexedDB.deleteDatabase(db.name!);
      });
    });

    cy.reload();
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
    cy.wait(1000)
      .get('.message-container')
      .eq(0)
      .get('.q-field .q-chip')
      .contains('function')
      .should('exist');

    startNewChat();

    cy.get('[aria-label="toggle task settings"]').click();

    cy.contains('myExample').click();

    selectllmmodel('taskyon', 'meta-llama/llama-3.1-8b-instruct');

    //cy.selectllmmodel('taskyon', 'meta-llama/llama-3.1-8b-instruct');

    writeMessage('can you add two strings for me: "stringone" & "stringtwo"?{enter}');

    cy.get('.message-container')
      .eq(0)
      .get('[aria-label="show message context"]')
      .click();

    console.log(
      'make sure, when creating a new chat & message, the function tag is gone...',
    );

    cy.wait(2000)
      .get('.message-container')
      .eq(0)
      .get('.q-field .q-chip')
      .should('not.exist');

    cy.wait(5000);

    checkLastMessage('stringone stringtwo');

    // unselect all tools
    cy.wait(100).contains('toggle').click();

    // select python
    startNewChat();
    cy.contains('executePython').click();
    writeMessage(
      "Can you calculate the prime numbers to 50 using a python script? Only give me the list in the final answer (2, 3, 5, ...), don't comment on the code{enter}",
    );

    checkLastMessage('2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47');

    startNewChat();
    // select js
    // unselect all tools
    cy.wait(100).contains('toggle').click();
    cy.contains('executeJava').click();

    writeMessage(
      'please calculate the sqrt of 111e3 using js to 5 decimals?{enter}',
    );

    checkLastMessage('333.1666');
  });
});
