// Use `cy.dataCy` custom command for more robust tests
// See https://docs.cypress.io/guides/references/best-practices.html#Selecting-Elements

// ** This file is an example of how to write Cypress tests, you can safely delete it **

// This test will pass when run against a clean Quasar project
describe('test taskyon defaults', () => {
  beforeEach(() => {
    /*if (!window.navigator || !navigator.serviceWorker) {
      return null;
    }
    const cypressPromise = new Cypress.Promise((resolve, reject) => {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        if (!registrations.length) resolve();
        Promise.all(registrations).then(() => {
          resolve();
        });
      });
    });
    cy.wrap('Unregister service workers').then(() => cypressPromise);*/

    cy.intercept('GET', '**/*.{png,jpg,jpeg,gif}', req => {
      req.reply({
        statusCode: 200,
        body: '',
        headers: {
              'Content-Type': 'image/png',
             },
        })
    }).as('stubImages')

    cy.wrap(
      Cypress.automation('remote:debugger:protocol', {
        command: 'Network.clearBrowserCache',
      })
    );

    cy.intercept('**').as('requests')
    //cy.visit('/');
    //cy.intercept('**').as('requests');
    cy.visit('/');
    //cy.get('@requests.all')meta-llama/llama-3-70b-instructmeta-llama/llama-3-70b-instruct.should('have.length', 10);
    //cy.get('*/src_layouts_TaskyonLayout_vue.js')

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
  it('should be able to send a free message and  get a response', () => {
    cy.title().should('include', 'Taskyon');

    cy.log('starting tests!');

    cy.get('.q-btn').contains('Use free Taskyon (low quality)').click();

    // enable task cost display & expert mode...
    cy.get('[aria-label="Expert mode"] > .q-toggle__inner').click();
    cy.get('[aria-label="Show task costs"] > .q-toggle__inner').click();

    cy.wait(2000).reload();
    // TODO: check if expert mode is still there...

    cy.get('[aria-label="toggle task settings"]').click();

    cy.contains('Vision').click();
    cy.contains('Fancy AI').click();

    cy.contains('your message').type('hello world!{enter}');
    //cy.get('li').first().click();
    //cy.contains('Clicks on todos: 1').should('exist');

    cy.get(
      '.user > .message-container > :nth-child(1) > .items-end > .col > .q-markdown > p',
    ).should('have.text', 'hello world!');
    cy.get('.assistant > .message-container').should('not.be.empty');

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
    cy.wait(5000)
      .get('.user .task-costs > div')
      .invoke('text')
      .invoke('trim')
      .then((text) => {
        const number = parseInt(text, 10);
        expect(number).to.match(/^\d+$/); // Check if the text is a number
        expect(number).to.be.greaterThan(10); // Check if the number is greater than 50
      });

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
