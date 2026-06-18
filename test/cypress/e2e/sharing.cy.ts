// Use `cy.dataCy` custom command for more robust tests
// See https://docs.cypress.io/guides/references/best-practices.html#Selecting-Elements

import { getLastAssistantMessage, writeMessage } from '../support/groups'

// ** This file is an example of how to write Cypress tests, you can safely delete it **

// This test will pass when run against a clean Quasar project
describe('Sharing functionality', () => {
  beforeEach(() => {
    cy.visit('/')
  })
  it('should be able to share a message and open it afterwards', () => {
    cy.log('starting tests!')

    cy.wait(1000)
    writeMessage('Hello world! how are you?')

    getLastAssistantMessage().should('exist')

    cy.get('[aria-label="share content"]').click()

    //TODO:  this is a problem...  because we can not test logging in to google here...
    //       cy.get('.q-btn').contains('through Gdrive').click();
  })
})
