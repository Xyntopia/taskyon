// Use `cy.dataCy` custom command for more robust tests
// See https://docs.cypress.io/guides/references/best-practices.html#Selecting-Elements

import { checkLastMessage, selectllmmodel } from '../support/groups';

// ** This file is an example of how to write Cypress tests, you can safely delete it **

// This test will pass when run against a clean Quasar project
describe('taskyon API', () => {
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
  it('should be able to interact with taskyon API', () => {
    cy.get('.q-btn').contains('Use free Taskyon').click();

    // enable task cost display & expert mode...
    cy.get('[aria-label="Expert mode"] > .q-toggle__inner').click();
    cy.get('[aria-label="Show task costs"] > .q-toggle__inner').click();

    cy.reload();

    cy.get('[aria-label="toggle task settings"]').click();
    cy.get('[aria-label="ai service settings"]').click();

    cy.contains('Add API keys').click();
    cy.contains('openai API key').type(Cypress.env().openai_api_key);
    cy.contains('openrouter.ai API key').type(Cypress.env().openrouter_api_key);

    cy.screenshot('ai_services', { overwrite: true });

    cy.visit('/');

    // as of 20241007 this is the cheapest model which works with vision...
    const visionModelID = 'google/gemini-flash-1.5-8b';

    selectllmmodel('openai', '');
    selectllmmodel('openrouter.ai', visionModelID);

    cy.wait(1000).reload();

    cy.log('checking if the correct llm was selected');
    cy.contains('Select LLM Model for answering/solving the task.')
      //  .parent()
      .get('.q-field__input.q-placeholder.col')
      .invoke('val')
      .then((val) => {
        cy.log(JSON.stringify(val));
        expect(val).to.eq(visionModelID); // Check if the text is a number
      });
    //.should('have.string', 'meta-llama/llama-3-70b-instruct');
    //.should('meta-llama/llama-3-70b-instruct');

    cy.get('.create-new-task .dropzone > input').selectFile(
      './public/taskyon_social_preview.png',
      { force: true },
    );

    cy.contains('your message').type('Whats in the picture?{enter}');

    checkLastMessage('taskyon.space').and('contain', 'logo');

    cy.screenshot('Vision models', { overwrite: true });

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

    // Check Tool Testsif the estimated tokens element is present and contains a number

    //.and('match', /^\d+/); // Check if it contains a number

    //cy.wa
  });
});

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
