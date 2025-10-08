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
    )
    cy.visit('/')
  })

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
        .then((body) => cy.wrap(body))
    )
  }

  const getIframeWindow = () => {
    return cy.get('iframe').its('0.contentWindow').should('exist')
  }

  const clearIframeStorage = () => {
    // Clear iframe localStorage and cookies
    getIframeWindow().then((iframeWin) => {
      iframeWin.localStorage.clear()
      iframeWin.sessionStorage.clear()

      // Clear IndexedDB of the iframe
      iframeWin.indexedDB.databases().then((databases: { name?: string }[]) => {
        databases.forEach((db) => {
          iframeWin.indexedDB.deleteDatabase(db.name!)
        })
      })
    })
  }

  it('Should be able to create a tool and use it through the iframe', () => {
    cy.visit('/clienttest')
    clearIframeStorage()

    // choose free model in iframe
    getIframeBody().find('.q-btn').contains('AI service provider se', { matchCase: false }).click()
    getIframeBody().find('.q-btn').contains('Use free Taskyon', { matchCase: false }).click()

    cy.reload()

    getIframeBody().should('exist')
    //getIframeBody().find('#q-app').should('exist');
    //getIframeBody().get('.q-btn').should('exist');
    // don't need this for our taskyon.space version...
    // getIframeBody().contains('Use free Taskyon').click()
    getIframeBody().find('button[aria-label="Open Sidebar"]').should('exist').click()

    /* TODO test "development" mode for iframe.. :)
      getIframeBody()
        .find('[aria-label="Expert mode"] > .q-toggle__inner')
        .click();
      getIframeBody()
        .find('[aria-label="Show task costs"] > .q-toggle__inner')
        .click();
      */

    //getIframeBody().find('button[aria-label="Open Sidebar"]').click();
    /*getIframeBody().click()

    // our string here looks a little funny, because we want to make sure, to prevent newlines!!
    const msg = `Can you add the two strings: “cypress” and “test function” for me using \
the clientTest function? make sure, you display the exact string how it is displayed \
(with/without whitespace etc…). Please use the exact tool I specified... \
{enter}`
    //getIframeBody().wait(10000).find('.msg-edit textarea').type(msg)
    // getIframeBody().find('[data-cy="chat-input"]').type(msg)
    getIframeBody().dataCy('chat-input').type(msg)
    getIframeBody().dataCy('chat-input').type('{enter}')*/

    getIframeBody().contains('Welcome!', { timeout: 10000 })
    getIframeBody().click()

    cy.wait(2000) // wait another two seconds for taskyon to settle...
    cy.contains('Execute Client').click()

    cy.get('#output').contains('cypresstest function', { timeout: 60000 })

    getIframeBody().contains('Result').click()
    getIframeBody().find('.toolresult').contains('cypresstest functio').should('exist')

    cy.dataCy('task-result', { timeout: 30000 })
      .invoke('text')
      .then((text) => {
        const jsonPart = text.slice(text.indexOf('{')).trim()
        console.log(jsonPart)
        const obj = JSON.parse(jsonPart)

        expect(obj).to.have.property('role', 'assistant')
        expect(obj).to.have.nested.property('content.type', 'message')
      })
    cy.screenshot('iframe_integration', { overwrite: true })

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
  })
})
