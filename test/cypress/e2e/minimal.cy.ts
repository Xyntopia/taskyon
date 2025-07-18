// Use `cy.dataCy` custom command for more robust tests
// See https://docs.cypress.io/guides/references/best-practices.html#Selecting-Elements

// ** This file is an example of how to write Cypress tests, you can safely delete it **

// This test will pass when run against a clean Quasar project
describe('test taskyon defaults', () => {
  beforeEach(() => {
    cy.log('simply loading the app...')
    cy.visit('/')
  })
  it('just check if taskyon is able to load...', () => {
    cy.title().should('include', 'Taskyon')
  })
})
