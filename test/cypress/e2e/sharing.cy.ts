// Use `cy.dataCy` custom command for more robust tests
// See https://docs.cypress.io/guides/references/best-practices.html#Selecting-Elements

import { getLastAssistantMessage, useFreeTaskyon, writeMessage } from '../support/groups'

// ** This file is an example of how to write Cypress tests, you can safely delete it **

// This test will pass when run against a clean Quasar project
describe('Landing', () => {
  beforeEach(() => {
    cy.visit('/')

    // Clear local storage
    cy.clearLocalStorage()

    // Clear cookies
    cy.clearCookies()

    // Optionally, you can clear indexedDB if your app uses it
    // somehow we're getting a lot of errors here...
    /*cy.window().then((win) => {
      void win.indexedDB.databases().then((databases) => {
        databases.forEach((db) => {
          win.indexedDB.deleteDatabase(db.name!);
        });
      });
    });*/
  })
  it('should be able to share a message and open it afterwards', () => {
    cy.log('starting tests!')

    useFreeTaskyon()

    writeMessage('Hello world! I want to share this with everyone!')

    getLastAssistantMessage().should('exist')

    cy.get('[aria-label="share content"]').click()

    //TODO:  this is a problem...  because we can not test logging in to google here...
    //       cy.get('.q-btn').contains('through Gdrive').click();
  })
})
