// Use `cy.dataCy` custom command for more robust tests
// See https://docs.cypress.io/guides/references/best-practices.html#Selecting-Elements

import {
  getLastAssistantMessage,
  selectllmmodel,
  useFreeTaskyon,
  writeMessage,
} from '../support/groups'

// ** This file is an example of how to write Cypress tests, you can safely delete it **

// This test will pass when run against a clean Quasar project
describe('test taskyon defaults', () => {
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
  it('should be able to send a free message and  get a response', () => {
    cy.title().should('include', 'Taskyon')

    cy.log('starting tests!')

    useFreeTaskyon()
    //cy.wait('[aria-label="quick ai settings"]')
    cy.get('[aria-label="quick ai settings"]', { timeout: 60000 }).click()

    const modelID = 'google/gemini-flash-1.5'
    selectllmmodel(undefined, modelID)

    // enable task cost display & expert mode...
    cy.contains('expertMode').next().click()
    cy.contains('showCosts').next().click()
    cy.contains('showCosts').next().next().click()
    cy.contains('Shows the costs of API calls.').type('{esc}')
    cy.get('.q-btn').contains('Ok').click()

    cy.wait(100).reload()
    // TODO: check if expert mode is still there...

    // check if more fancy options ae present  now...
    cy.get('[aria-label="quick ai settings"]', { timeout: 60000 }).click()
    cy.contains('Vision')
    cy.contains('Fancy AI').type('{esc}')

    //cy.dataCy('chat-input').focus().type('{enter}')
    //cy.get('li').first().click();
    //cy.contains('Clicks on todos: 1').should('exist');

    const msg = 'hello world you silly munchkin!!'
    writeMessage(msg)

    getLastAssistantMessage('.user.message')
      .invoke('text')
      .then((text) => text.trim())
      .should('equal', msg)
    getLastAssistantMessage('.assistant.message').should('not.be.empty')

    // Check if the task costs element is present and contains the expected text
    /*cy.get('.task-costs')
      .should('exist')
      .and('contain.text', '$') // Adjust this based on the expected format of task costs
      .or('contain.text', '¢')
      .or('contain.text', 'μ$');

    // Check if the prompt tokens element is present and contains a number
    cy.wait(10000)
      .get('.task-costs')
      .find('div')
      .eq(1) // Assuming the second div contains the prompt tokens
      .should('exist')
      .and('match', /\d+/); // Check if it contains a number*/

    // Check if the estimated tokens element is present and contains a number
    /*cy.wait(5000)
      .get('.user .task-costs > div')
      .invoke('text')
      .invoke('trim')
      .then((text) => {
        const number = parseInt(text)
        expect(number).to.match(/^\d+$/) // Check if the text is a number
        expect(number).to.be.greaterThan(5) // Check if the number is greater than 50
      })*/

    //.and('match', /^\d+/); // Check if it contains a number

    //cy.wa
  })
})

// ** The following code is an example to show you how to write some tests for your home page **
//
// describe('Home page tests', () => {
//   beforeEach(() => {
//     cy.visit('/');
//   });
//   it('has pretty background', () => {
//     cy.dataCy('landing-wrapper')
//       .should('have.css', 'background')
//       .and('match', /(".+(\/img\/background).+\.png)/);
//   });
//   it('has pretty logo', () => {
//     cy.dataCy('landing-wrapper img')
//       .should('have.class', 'logo-main')
//       .and('have.attr', 'src')
//       .and('match', /^(data:image\/svg\+xml).+/);
//   });
//   it('has very important information', () => {
//     cy.dataCy('instruction-wrapper')
//       .should('contain', 'SETUP INSTRUCTIONS')
//       .and('contain', 'Configure Authentication')
//       .and('contain', 'Database Configuration and CRUD operations')
//       .and('contain', 'Continuous Integration & Continuous Deployment CI/CD');
//   });
// });
