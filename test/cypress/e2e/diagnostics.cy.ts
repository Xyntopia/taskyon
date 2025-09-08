// Use `cy.dataCy` custom command for more robust tests
// See https://docs.cypress.io/guides/references/best-practices.html#Selecting-Elements

import { addAIServices } from '../support/groups'

// ** This file is an example of how to write Cypress tests, you can safely delete it **

// This test will pass when run against a clean Quasar project
describe('run diagnostics', () => {
  beforeEach(() => {
    cy.visit('/')
    // Clear local storage
    //cy.clearLocalStorage()

    // Clear cookies
    //cy.clearCookies()

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
  it('fast testing of a few taskyon operations', () => {
    addAIServices()
    cy.get('.q-btn').contains('Use free Taskyon', { matchCase: false }).click()

    cy.log('starting tests!')

    cy.get('#ty-space-menu').click()
    cy.contains('About').click()
    cy.contains('Diagnostics').click()

    cy.dataCy('run-tests').click()

    cy.get(`[data-cy="test-finished"]`, { timeout: 60000 }).contains('Test Finished')

    cy.dataCy('diagnostics-result', { timeout: 60000 }).should(($el) => {
      const text = $el.text().trim().toLowerCase()
      const lines = text.split('\n').map((l) => l.trim())
      const lastLine = lines[lines.length - 1]
      expect(lastLine).to.eq('finished all tests!')
    })

    const minOk = 10
    cy.dataCy('diagnostics-result')
      .invoke('text')
      .then((txt) => {
        const okCount = (txt.match(/ok/gi) || []).length // case-insensitive “OK”
        cy.log(`OK count: ${okCount}`)

        expect(okCount, 'OKs > min').to.be.greaterThan(minOk)
        expect(/error/i.test(txt), 'no “Error” present').to.be.false
      })
    cy.screenshot('diagnostics report', { overwrite: true })
  })
})
